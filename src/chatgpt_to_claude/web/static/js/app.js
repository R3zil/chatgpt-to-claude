// ChatGPT → Claude — Web UI

(function () {
    "use strict";

    // ─── State ───
    let sessionId = null;
    let conversations = [];
    let filteredConversations = [];
    let selectedIds = new Set();
    let currentPage = 1;
    const PAGE_SIZE = 50;

    // ─── Elements ───
    const $ = (sel) => document.querySelector(sel);
    const dropZone = $("#drop-zone");
    const fileInput = $("#file-input");
    const browseBtn = $("#browse-btn");
    const uploadProgress = $("#upload-progress");
    const progressFill = $(".progress-fill");
    const progressText = $(".progress-text");
    const uploadError = $("#upload-error");
    const uploadSection = $("#upload-section");
    const previewSection = $("#preview-section");
    const convList = $("#conversation-list");
    const searchInput = $("#search-input");
    const selectAllBtn = $("#select-all-btn");
    const selectNoneBtn = $("#select-none-btn");
    const selectionCount = $("#selection-count");
    const convertBtn = $("#convert-btn");
    const convertAllBtn = $("#convert-all-btn");
    const startOverBtn = $("#start-over-btn");
    const convertingOverlay = $("#converting-overlay");
    const previewModal = $("#preview-modal");
    const previewTitle = $("#preview-title");
    const previewBody = $("#preview-body");
    const previewClose = $("#preview-close");
    const pagination = $("#pagination");

    // ─── Upload Handling ───

    browseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    });

    async function handleFile(file) {
        if (!file.name.toLowerCase().endsWith(".zip")) {
            showError("Please upload a .zip file");
            return;
        }

        hideError();
        uploadProgress.hidden = false;
        progressFill.style.width = "30%";
        progressText.textContent = "Uploading...";

        const formData = new FormData();
        formData.append("file", file);

        try {
            progressFill.style.width = "60%";
            progressText.textContent = "Processing...";

            const resp = await fetch("/api/upload", { method: "POST", body: formData });
            const data = await resp.json();

            if (!resp.ok) {
                showError(data.error || "Upload failed");
                uploadProgress.hidden = true;
                return;
            }

            progressFill.style.width = "100%";
            progressText.textContent = "Done!";

            sessionId = data.session_id;
            conversations = data.conversations;
            filteredConversations = conversations;
            selectedIds = new Set(conversations.map((c) => c.id));

            displayStats(data.statistics);
            renderConversationList();
            updateSelectionCount();

            setTimeout(() => {
                uploadSection.hidden = true;
                previewSection.hidden = false;
            }, 500);
        } catch (err) {
            showError("Failed to upload: " + err.message);
            uploadProgress.hidden = true;
        }
    }

    function showError(msg) {
        uploadError.textContent = msg;
        uploadError.hidden = false;
    }

    function hideError() {
        uploadError.hidden = true;
    }

    // ─── Stats Display ───

    function displayStats(stats) {
        $("#stat-conversations").textContent = stats.total_conversations.toLocaleString();
        $("#stat-messages").textContent = stats.total_messages.toLocaleString();

        if (stats.date_range.start && stats.date_range.end) {
            const start = stats.date_range.start.slice(0, 10);
            const end = stats.date_range.end.slice(0, 10);
            $("#stat-date-range").textContent = `${start} → ${end}`;
        }

        const models = Object.keys(stats.models_used);
        if (models.length > 0) {
            $("#stat-models").textContent = models.length <= 3
                ? models.join(", ")
                : `${models.slice(0, 2).join(", ")} +${models.length - 2}`;
        }
    }

    // ─── Conversation List ───

    function renderConversationList() {
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filteredConversations.slice(start, start + PAGE_SIZE);

        convList.innerHTML = "";

        if (pageItems.length === 0) {
            convList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No conversations found</p>';
            return;
        }

        for (const conv of pageItems) {
            const item = document.createElement("div");
            item.className = "conv-item";

            const date = conv.created_at ? conv.created_at.slice(0, 10) : "Unknown date";
            const models = conv.model_slugs.join(", ") || "";
            const modelInfo = models ? ` | ${models}` : "";

            item.innerHTML = `
                <input type="checkbox" data-id="${conv.id}" ${selectedIds.has(conv.id) ? "checked" : ""}>
                <div class="conv-info">
                    <div class="conv-title">${escapeHtml(conv.title)}</div>
                    <div class="conv-meta">${date} | ${conv.message_count} msgs${modelInfo}</div>
                </div>
                <button class="conv-preview-btn" data-id="${conv.id}">Preview</button>
            `;

            const checkbox = item.querySelector("input");
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedIds.add(conv.id);
                } else {
                    selectedIds.delete(conv.id);
                }
                updateSelectionCount();
            });

            item.querySelector(".conv-preview-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                openPreview(conv.id, conv.title);
            });

            // Click row to toggle checkbox
            item.addEventListener("click", (e) => {
                if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event("change"));
                }
            });

            convList.appendChild(item);
        }

        renderPagination();
    }

    function renderPagination() {
        const totalPages = Math.ceil(filteredConversations.length / PAGE_SIZE);
        pagination.innerHTML = "";

        if (totalPages <= 1) return;

        const prevBtn = document.createElement("button");
        prevBtn.textContent = "← Prev";
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener("click", () => { currentPage--; renderConversationList(); });
        pagination.appendChild(prevBtn);

        // Show page numbers (max 7 visible)
        const startPage = Math.max(1, currentPage - 3);
        const endPage = Math.min(totalPages, startPage + 6);

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement("button");
            btn.textContent = i;
            if (i === currentPage) btn.className = "active";
            btn.addEventListener("click", () => { currentPage = i; renderConversationList(); });
            pagination.appendChild(btn);
        }

        const nextBtn = document.createElement("button");
        nextBtn.textContent = "Next →";
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener("click", () => { currentPage++; renderConversationList(); });
        pagination.appendChild(nextBtn);
    }

    function updateSelectionCount() {
        selectionCount.textContent = `${selectedIds.size} selected`;
        convertBtn.textContent = `Convert Selected (${selectedIds.size})`;
        convertBtn.disabled = selectedIds.size === 0;
    }

    // ─── Search ───

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            filteredConversations = conversations;
        } else {
            filteredConversations = conversations.filter((c) =>
                c.title.toLowerCase().includes(query)
            );
        }
        currentPage = 1;
        renderConversationList();
    });

    // ─── Selection Controls ───

    selectAllBtn.addEventListener("click", () => {
        selectedIds = new Set(filteredConversations.map((c) => c.id));
        renderConversationList();
        updateSelectionCount();
    });

    selectNoneBtn.addEventListener("click", () => {
        selectedIds.clear();
        renderConversationList();
        updateSelectionCount();
    });

    // ─── Preview ───

    async function openPreview(convId, title) {
        previewTitle.textContent = title;
        previewBody.innerHTML = '<div class="spinner"></div>';
        previewModal.hidden = false;

        try {
            const resp = await fetch(`/api/preview/${sessionId}/${convId}`);
            const data = await resp.json();

            if (!resp.ok) {
                previewBody.textContent = data.error || "Failed to load preview";
                return;
            }

            previewBody.textContent = data.markdown;
        } catch (err) {
            previewBody.textContent = "Error loading preview: " + err.message;
        }
    }

    previewClose.addEventListener("click", () => { previewModal.hidden = true; });
    previewModal.addEventListener("click", (e) => {
        if (e.target === previewModal) previewModal.hidden = true;
    });

    // ─── Conversion ───

    convertBtn.addEventListener("click", () => convertAndDownload(Array.from(selectedIds)));
    convertAllBtn.addEventListener("click", () => convertAndDownload(null));

    async function convertAndDownload(ids) {
        convertingOverlay.hidden = false;

        const options = {
            session_id: sessionId,
            conversation_ids: ids,
            organize: $("#opt-organize").value,
            include_frontmatter: $("#opt-frontmatter").checked,
        };

        try {
            const resp = await fetch("/api/convert", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(options),
            });
            const data = await resp.json();

            if (!resp.ok) {
                alert("Conversion failed: " + (data.error || "Unknown error"));
                convertingOverlay.hidden = true;
                return;
            }

            // Trigger download
            window.location.href = `/api/download/${sessionId}`;

            setTimeout(() => { convertingOverlay.hidden = true; }, 2000);
        } catch (err) {
            alert("Conversion error: " + err.message);
            convertingOverlay.hidden = true;
        }
    }

    // ─── Start Over ───

    startOverBtn.addEventListener("click", () => {
        sessionId = null;
        conversations = [];
        filteredConversations = [];
        selectedIds.clear();
        currentPage = 1;
        uploadProgress.hidden = true;
        previewSection.hidden = true;
        uploadSection.hidden = false;
        fileInput.value = "";
        searchInput.value = "";
    });

    // ─── Utilities ───

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
})();
