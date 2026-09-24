const STORAGE_KEY = "mein-deutsch.permanent-data";
const GRAMMAR_STORAGE_KEY = "mein-deutsch.grammar-data";
const BACKUP_KEY = "mein-deutsch.automatic-backups";
const LEGACY_STORAGE_KEYS = ["my-german-app.entries.v1"];
const CURRENT_SCHEMA_VERSION = 5;
const MAX_BACKUP_FILE_SIZE = 10 * 1024 * 1024;
const PUBLISH_HELPER_URL = "http://127.0.0.1:8765/api/publish";
const IS_PUBLIC_SITE = window.location.hostname === "xiaonaguo90-beep.github.io";

const addButton = document.querySelector("#addButton");
const modeButtons = document.querySelectorAll(".mode-button");
const composer = document.querySelector("#composer");
const form = document.querySelector("#entryForm");
const cancelButton = document.querySelector("#cancelButton");
const polishButton = document.querySelector("#polishButton");
const saveButton = document.querySelector("#saveButton");
const grammarComposer = document.querySelector("#grammarComposer");
const grammarForm = document.querySelector("#grammarForm");
const grammarCancelButton = document.querySelector("#grammarCancelButton");
const grammarPolishButton = document.querySelector("#grammarPolishButton");
const grammarSaveButton = document.querySelector("#grammarSaveButton");
const searchInput = document.querySelector("#searchInput");
const sourceFilter = document.querySelector("#sourceFilter");
const entriesEl = document.querySelector("#entries");
const grammarEntriesEl = document.querySelector("#grammarEntries");
const countText = document.querySelector("#countText");
const saveStatus = document.querySelector("#saveStatus");
const backupButton = document.querySelector("#backupButton");
const importBackupButton = document.querySelector("#importBackupButton");
const publishButton = document.querySelector("#publishButton");
const backupFileInput = document.querySelector("#backupFileInput");
const template = document.querySelector("#entryTemplate");
const grammarTemplate = document.querySelector("#grammarTemplate");

let entries = loadEntries();
let grammarEntries = loadGrammarEntries();
let editingEntryId = null;
let editingGrammarId = null;
let activeMode = "vocabulary";
let activePronunciationAudio = null;
let pronunciationRequestId = 0;
const pronunciationCache = new Map();

addButton.addEventListener("click", () => {
  if (activeMode === "grammar") {
    if (isGrammarComposerOpen()) {
      grammarForm.requestSubmit();
      return;
    }

    startGrammarCreate();
    return;
  }

  if (isVocabularyComposerOpen()) {
    form.requestSubmit();
    return;
  }

  startCreate();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
});

cancelButton.addEventListener("click", () => {
  closeComposer();
});

polishButton.addEventListener("click", () => {
  polishWriting();
});

grammarCancelButton.addEventListener("click", () => {
  closeGrammarComposer();
});

grammarPolishButton.addEventListener("click", () => {
  polishGrammarWriting();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const editedEntry = entries.find((entry) => entry.id === editingEntryId);
  const entryData = {
    level: getFormValue(data, "level"),
    book: getFormValue(data, "book"),
    lesson: getFormValue(data, "lesson"),
    german: getFormValue(data, "german"),
    chinese: getFormValue(data, "chinese"),
    english: getFormValue(data, "english"),
    example: getFormValue(data, "example"),
    translation: getFormValue(data, "translation"),
    updatedAt: new Date().toISOString(),
  };

  if (editedEntry) {
    Object.assign(editedEntry, entryData);
  } else {
    entries.unshift({
      id: crypto.randomUUID(),
      ...entryData,
      createdAt: new Date().toISOString(),
    });
  }

  saveEntries();
  closeComposer();
  render();
});

grammarForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(grammarForm);
  const editedGrammar = grammarEntries.find((entry) => entry.id === editingGrammarId);
  const grammarData = {
    title: getFormValue(data, "title"),
    lesson: getFormValue(data, "lesson"),
    rule: getFormValue(data, "rule"),
    pattern: getFormValue(data, "pattern"),
    example: getFormValue(data, "example"),
    note: getFormValue(data, "note"),
    updatedAt: new Date().toISOString(),
  };

  if (editedGrammar) {
    Object.assign(editedGrammar, grammarData);
  } else {
    grammarEntries.unshift({
      id: crypto.randomUUID(),
      ...grammarData,
      createdAt: new Date().toISOString(),
    });
  }

  saveGrammarEntries();
  closeGrammarComposer();
  render();
});

searchInput.addEventListener("input", render);
sourceFilter.addEventListener("change", render);
backupButton.addEventListener("click", downloadBackup);
publishButton.addEventListener("click", publishMobileData);
importBackupButton.addEventListener("click", () => {
  backupFileInput.value = "";
  backupFileInput.click();
});
backupFileInput.addEventListener("change", () => {
  const file = backupFileInput.files?.[0];
  if (file) importBackup(file);
});

entriesEl.addEventListener("click", (event) => {
  const speakButton = event.target.closest(".speak-button");
  const editButton = event.target.closest(".edit-button");
  const moreButton = event.target.closest(".more-button");
  const deleteButton = event.target.closest(".delete-button");
  if (!speakButton && !editButton && !moreButton && !deleteButton) return;

  const card = event.target.closest(".card");
  const entry = entries.find((item) => item.id === card.dataset.id);
  if (!entry) return;

  if (speakButton) {
    const field = speakButton.dataset.speakField;
    const text = field === "example" ? entry.example || "" : entry.german || "";
    const emptyMessage = field === "example"
      ? "这条记录里还没有德语例句可以发音。"
      : "这条记录里还没有德语单词或句子可以发音。";
    if (field === "example") {
      speakGerman(text, emptyMessage);
    } else {
      speakGermanWord(text, emptyMessage);
    }
  }

  if (editButton) {
    startEdit(entry);
  }

  if (moreButton) {
    const dangerActions = card.querySelector(".danger-actions");
    dangerActions.classList.toggle("hidden");
    moreButton.textContent = dangerActions.classList.contains("hidden") ? "更多" : "收起";
  }

  if (deleteButton) {
    const ok = confirm("确定要删除这条记录吗？删除前会自动备份。");
    if (!ok) return;

    entries = entries.filter((item) => item.id !== entry.id);
    saveEntries();
    render();
  }
});

grammarEntriesEl.addEventListener("click", (event) => {
  const speakButton = event.target.closest(".speak-grammar-button");
  const editButton = event.target.closest(".grammar-edit-button");
  const moreButton = event.target.closest(".grammar-more-button");
  const deleteButton = event.target.closest(".grammar-delete-button");
  if (!speakButton && !editButton && !moreButton && !deleteButton) return;

  const card = event.target.closest(".card");
  const entry = grammarEntries.find((item) => item.id === card.dataset.id);
  if (!entry) return;

  if (speakButton) {
    speakGerman(entry.example || "", "这条语法里还没有德语例句可以发音。");
  }

  if (editButton) {
    startGrammarEdit(entry);
  }

  if (moreButton) {
    const dangerActions = card.querySelector(".danger-actions");
    dangerActions.classList.toggle("hidden");
    moreButton.textContent = dangerActions.classList.contains("hidden") ? "更多" : "收起";
  }

  if (deleteButton) {
    const ok = confirm("确定要删除这条语法记录吗？删除前会自动备份。");
    if (!ok) return;

    grammarEntries = grammarEntries.filter((item) => item.id !== entry.id);
    saveGrammarEntries();
    render();
  }
});

function render() {
  if (activeMode === "grammar") {
    renderGrammar();
    return;
  }

  renderVocabulary();
}

function renderVocabulary() {
  grammarEntriesEl.replaceChildren();
  renderSourceFilter();

  const query = searchInput.value.trim().toLowerCase();
  const activeSource = sourceFilter.value;
  const visibleEntries = entries.filter((entry) => {
    const source = displaySource(entry);
    const matchesSource = activeSource === "全部" || source === activeSource;
    const matchesSearch = [
      source,
      entry.german,
      entry.chinese,
      entry.english,
      entry.example,
      entry.translation,
    ].join(" ").toLowerCase().includes(query);
    return matchesSource && matchesSearch;
  });

  countText.textContent = `${visibleEntries.length} 条记录`;
  entriesEl.replaceChildren();

  if (!visibleEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = entries.length ? "没有找到匹配内容。" : "点击“新增”，保存你的第一条德语学习内容。";
    entriesEl.append(empty);
    return;
  }

  visibleEntries.forEach((entry) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = entry.id;
    card.querySelector(".date").textContent = formatDate(entry.createdAt);
    card.querySelector(".source").textContent = displaySource(entry);
    card.querySelector(".german").textContent = entry.german || "未填写德语";
    setOptionalField(card, "chinese", entry.chinese);
    setOptionalField(card, "english", entry.english);
    setOptionalField(card, "example", entry.example);
    setOptionalField(card, "translation", entry.translation);
    entriesEl.append(card);
  });
}

function renderGrammar() {
  entriesEl.replaceChildren();
  const query = searchInput.value.trim().toLowerCase();
  const visibleEntries = grammarEntries.filter((entry) => {
    return [
      entry.title,
      entry.lesson,
      entry.rule,
      entry.pattern,
      entry.example,
      entry.note,
    ].join(" ").toLowerCase().includes(query);
  });

  countText.textContent = `${visibleEntries.length} 条语法`;
  grammarEntriesEl.replaceChildren();

  if (!visibleEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = grammarEntries.length ? "没有找到匹配的语法。" : "点击“新增”，保存你的第一条纯语法笔记。";
    grammarEntriesEl.append(empty);
    return;
  }

  visibleEntries.forEach((entry) => {
    const card = grammarTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = entry.id;
    card.querySelector(".date").textContent = formatDate(entry.createdAt);
    card.querySelector(".source").textContent = entry.lesson || "未设置课程";
    card.querySelector(".grammar-title").textContent = entry.title || "未填写语法标题";
    if (!entry.example) {
      card.querySelector(".speak-grammar-button").remove();
    }
    setOptionalField(card, "rule", entry.rule);
    setOptionalField(card, "pattern", entry.pattern);
    setOptionalField(card, "example", entry.example);
    setOptionalField(card, "note", entry.note);
    grammarEntriesEl.append(card);
  });
}

function renderSourceFilter() {
  const selected = sourceFilter.value || "全部";
  const sources = [...new Set(entries.map(displaySource))].sort((a, b) => a.localeCompare(b, "zh-CN"));

  sourceFilter.replaceChildren(new Option("全部来源", "全部"));
  sources.forEach((source) => {
    sourceFilter.append(new Option(source, source));
  });

  sourceFilter.value = sources.includes(selected) ? selected : "全部";
}

function setOptionalField(card, field, value) {
  const row = card.querySelector(`[data-field="${field}"]`);
  if (!value) {
    row.remove();
    return;
  }

  card.querySelector(`.${field}`).textContent = value;
}

function getFormValue(data, name) {
  return (data.get(name) || "").trim();
}

function setMode(mode) {
  activeMode = mode === "grammar" ? "grammar" : "vocabulary";
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === activeMode);
  });

  closeComposer();
  closeGrammarComposer();
  searchInput.value = "";
  entriesEl.classList.toggle("hidden", activeMode !== "vocabulary");
  grammarEntriesEl.classList.toggle("hidden", activeMode !== "grammar");
  sourceFilter.classList.toggle("hidden", activeMode !== "vocabulary");
  searchInput.placeholder = activeMode === "grammar"
    ? "搜索语法标题、规则、结构或例句"
    : "搜索德语、中文、English 或例句";

  render();
}

function startCreate() {
  editingEntryId = null;
  form.reset();
  document.querySelector(".extra-fields").open = false;
  saveButton.textContent = "保存";
  addButton.textContent = "保存";
  composer.classList.remove("hidden");
  document.querySelector("#germanInput").focus();
}

function startGrammarCreate() {
  editingGrammarId = null;
  grammarForm.reset();
  grammarSaveButton.textContent = "保存";
  addButton.textContent = "保存";
  grammarComposer.classList.remove("hidden");
  document.querySelector("#grammarTitleInput").focus();
}

function startEdit(entry) {
  editingEntryId = entry.id;
  form.elements.level.value = entry.level || "";
  form.elements.book.value = entry.book || "";
  form.elements.lesson.value = entry.lesson || "";
  form.elements.german.value = entry.german;
  form.elements.chinese.value = entry.chinese;
  form.elements.english.value = entry.english;
  form.elements.example.value = entry.example;
  form.elements.translation.value = entry.translation;
  document.querySelector(".extra-fields").open = Boolean(entry.english || entry.example || entry.translation);
  saveButton.textContent = "保存修改";
  addButton.textContent = "保存";
  composer.classList.remove("hidden");
  composer.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#germanInput").focus();
}

function startGrammarEdit(entry) {
  editingGrammarId = entry.id;
  grammarForm.elements.title.value = entry.title || "";
  grammarForm.elements.lesson.value = entry.lesson || "";
  grammarForm.elements.rule.value = entry.rule || "";
  grammarForm.elements.pattern.value = entry.pattern || "";
  grammarForm.elements.example.value = entry.example || "";
  grammarForm.elements.note.value = entry.note || "";
  grammarSaveButton.textContent = "保存修改";
  addButton.textContent = "保存";
  grammarComposer.classList.remove("hidden");
  grammarComposer.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#grammarTitleInput").focus();
}

function closeComposer() {
  editingEntryId = null;
  form.reset();
  document.querySelector(".extra-fields").open = false;
  saveButton.textContent = "保存";
  addButton.textContent = "新增";
  composer.classList.add("hidden");
}

function closeGrammarComposer() {
  editingGrammarId = null;
  grammarForm.reset();
  grammarSaveButton.textContent = "保存";
  addButton.textContent = "新增";
  grammarComposer.classList.add("hidden");
}

function polishWriting() {
  form.elements.book.value = normalizeInlineText(form.elements.book.value).toUpperCase();
  form.elements.lesson.value = normalizeInlineText(form.elements.lesson.value);
  form.elements.german.value = normalizeGermanText(form.elements.german.value, { capitalize: false });
  form.elements.chinese.value = normalizeInlineText(form.elements.chinese.value);
  form.elements.english.value = normalizeInlineText(form.elements.english.value);
  form.elements.example.value = normalizeGermanText(form.elements.example.value, { capitalize: true });
  form.elements.translation.value = normalizeParagraphText(form.elements.translation.value);
  showSaveStatus("书写已整理");
}

function polishGrammarWriting() {
  grammarForm.elements.title.value = normalizeInlineText(grammarForm.elements.title.value);
  grammarForm.elements.lesson.value = normalizeInlineText(grammarForm.elements.lesson.value);
  grammarForm.elements.rule.value = normalizeParagraphText(grammarForm.elements.rule.value);
  grammarForm.elements.pattern.value = normalizeParagraphText(grammarForm.elements.pattern.value);
  grammarForm.elements.example.value = normalizeGermanText(grammarForm.elements.example.value, { capitalize: true });
  grammarForm.elements.note.value = normalizeParagraphText(grammarForm.elements.note.value);
  showSaveStatus("书写已整理");
}

function isVocabularyComposerOpen() {
  return !composer.classList.contains("hidden");
}

function isGrammarComposerOpen() {
  return !grammarComposer.classList.contains("hidden");
}

function normalizeInlineText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeParagraphText(text) {
  return text
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .join("\n")
    .trim();
}

function normalizeGermanText(text, options = {}) {
  const { capitalize = false } = options;
  let normalized = normalizeParagraphText(text)
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=\S)/g, "$1 ")
    .replace(/\s+(['"”])/g, "$1")
    .replace(/(['"“])\s+/g, "$1");

  if (capitalize) {
    normalized = normalized.replace(/(^|[.!?]\s+)([a-zäöüß])/g, (match, prefix, letter) => {
      return `${prefix}${letter.toLocaleUpperCase("de-DE")}`;
    });
  }

  return normalized.trim();
}

function loadEntries() {
  const permanentEntries = extractEntries(readStorage(STORAGE_KEY));
  if (permanentEntries.length) {
    return permanentEntries;
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacyEntries = extractEntries(readStorage(key));
    if (legacyEntries.length) {
      return legacyEntries;
    }
  }

  return [];
}

function loadGrammarEntries() {
  const savedGrammarEntries = extractGrammarEntries(readStorage(GRAMMAR_STORAGE_KEY));
  if (savedGrammarEntries.length) {
    return savedGrammarEntries;
  }

  const permanentData = readStorage(STORAGE_KEY);
  return extractGrammarEntries(permanentData?.grammarEntries);
}

function saveEntries(options = {}) {
  const { backup = true, status = true } = options;
  if (backup) {
    createAutomaticBackup();
  }

  const data = {
    app: "Mein Deutsch",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries,
    grammarEntries,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  localStorage.setItem(LEGACY_STORAGE_KEYS[0], JSON.stringify(entries));
  if (status) {
    showSaveStatus("数据已安全保存");
  }
}

function saveGrammarEntries(options = {}) {
  const { backup = true, status = true } = options;
  if (backup) {
    createAutomaticBackup();
  }

  const data = {
    app: "Mein Deutsch Grammar",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    grammarEntries,
  };

  localStorage.setItem(GRAMMAR_STORAGE_KEY, JSON.stringify(data));
  saveEntries({ backup: false, status: false });
  if (status) {
    showSaveStatus("数据已安全保存");
  }
}

function readStorage(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function extractEntries(data) {
  const rawEntries = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries.map(normalizeEntry).filter(isValidEntry);
}

function extractGrammarEntries(data) {
  const rawEntries = Array.isArray(data) ? data : data?.grammarEntries;
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries.map(normalizeGrammarEntry).filter(isValidEntry);
}

function normalizeEntry(entry) {
  return {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    category: entry.category || "",
    level: entry.level || "",
    book: entry.book || "",
    lesson: entry.lesson || "",
    german: entry.german || "",
    chinese: entry.chinese || "",
    english: entry.english || "",
    example: entry.example || "",
    translation: entry.translation || "",
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

function normalizeGrammarEntry(entry) {
  return {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    title: entry.title || "",
    lesson: entry.lesson || "",
    rule: entry.rule || "",
    pattern: entry.pattern || "",
    example: entry.example || "",
    note: entry.note || "",
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

function createAutomaticBackup() {
  const existingEntries = extractEntries(readStorage(STORAGE_KEY));
  const existingGrammarEntries = extractGrammarEntries(readStorage(GRAMMAR_STORAGE_KEY));
  if (!existingEntries.length && !existingGrammarEntries.length) return;

  const savedBackups = readStorage(BACKUP_KEY);
  const backups = Array.isArray(savedBackups) ? savedBackups : [];
  backups.unshift({
    createdAt: new Date().toISOString(),
    entries: existingEntries,
    grammarEntries: existingGrammarEntries,
  });

  localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(0, 10)));
}

function downloadBackup() {
  const data = createExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mein-deutsch-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showSaveStatus("备份已导出");
}

function createExportData() {
  return {
    app: "Mein Deutsch",
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    entries,
    grammarEntries,
  };
}

async function publishMobileData() {
  const originalText = publishButton.textContent;
  publishButton.disabled = true;
  publishButton.textContent = "正在更新…";
  showSaveStatus("正在安全发布");

  try {
    const response = await fetch(PUBLISH_HELPER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createExportData()),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "本机发布助手返回错误。");
    }

    showSaveStatus("手机版已更新");
    alert(
      `手机版已更新：${result.entries} 条单词数据，${result.grammarEntries} 条语法数据。\n\n`
      + "请在 iPhone 上刷新页面；GitHub Pages 通常需要几十秒完成更新。",
    );
  } catch (error) {
    showSaveStatus("更新手机版失败");
    alert(
      "更新手机版失败。Mac 上的学习数据没有受到影响。\n\n"
      + `${error.message || "无法连接本机发布助手。"}\n\n`
      + "请确认 Mein Deutsch 发布助手正在运行后重试。",
    );
  } finally {
    publishButton.disabled = false;
    publishButton.textContent = originalText;
  }
}

async function importBackup(file) {
  try {
    if (file.size > MAX_BACKUP_FILE_SIZE) {
      throw new Error("备份文件超过 10 MB，已取消导入。");
    }

    const data = JSON.parse(await file.text());
    const importedData = validateBackupData(data);
    const confirmed = confirm(
      `备份验证通过，将导入 ${importedData.entries.length} 条单词数据和 ${importedData.grammarEntries.length} 条语法数据。\n\n`
      + `当前的 ${entries.length} 条单词数据和 ${grammarEntries.length} 条语法数据将被替换。导入前会自动下载当前数据备份，并在浏览器中保存一个恢复点。\n\n确定继续吗？`,
    );
    if (!confirmed) return;

    const previousEntries = entries;
    const previousGrammarEntries = grammarEntries;
    const storageSnapshot = {
      permanent: localStorage.getItem(STORAGE_KEY),
      grammar: localStorage.getItem(GRAMMAR_STORAGE_KEY),
      legacy: localStorage.getItem(LEGACY_STORAGE_KEYS[0]),
    };

    if (entries.length || grammarEntries.length) {
      downloadPreImportBackup();
    }
    createAutomaticBackup();

    try {
      entries = importedData.entries;
      grammarEntries = importedData.grammarEntries;
      saveEntries({ backup: false, status: false });
      saveGrammarEntries({ backup: false, status: false });
    } catch {
      entries = previousEntries;
      grammarEntries = previousGrammarEntries;
      let rollbackSucceeded = true;
      try {
        restoreStorageSnapshot(storageSnapshot);
      } catch {
        rollbackSucceeded = false;
      }
      render();
      throw new Error(rollbackSucceeded
        ? "写入浏览器存储失败，原有数据已恢复。请保留自动下载的导入前备份。"
        : "写入和自动回滚均失败。请不要重新加载页面，并使用自动下载的导入前备份恢复。"
      );
    }

    alert(`导入成功：${entries.length} 条单词数据，${grammarEntries.length} 条语法数据。页面将重新加载。`);
    window.location.reload();
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "文件不是有效的 JSON。"
      : error.message || "无法读取这个备份文件。";
    alert(`无法导入备份：${message}`);
  } finally {
    backupFileInput.value = "";
  }
}

function validateBackupData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("备份内容格式不正确。");
  }

  if (data.app !== "Mein Deutsch") {
    throw new Error("这不是由当前网站导出的备份文件。");
  }

  if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`备份 schema 版本不兼容，需要版本 ${CURRENT_SCHEMA_VERSION}。`);
  }

  if (typeof data.exportedAt !== "string" || Number.isNaN(Date.parse(data.exportedAt))) {
    throw new Error("备份缺少有效的导出时间。");
  }

  if (!Array.isArray(data.entries) || !Array.isArray(data.grammarEntries)) {
    throw new Error("备份必须同时包含 entries 和 grammarEntries。");
  }

  const vocabularyFields = [
    "id", "level", "book", "lesson", "german", "chinese",
    "english", "example", "translation", "createdAt",
  ];
  const grammarFields = [
    "id", "title", "lesson", "rule", "pattern", "example", "note", "createdAt",
  ];
  const invalidEntryIndex = data.entries.findIndex((entry) => {
    return !isValidBackupRecord(entry, vocabularyFields, ["category"]);
  });
  const invalidGrammarIndex = data.grammarEntries.findIndex((entry) => {
    return !isValidBackupRecord(entry, grammarFields);
  });

  if (invalidEntryIndex !== -1) {
    throw new Error(`第 ${invalidEntryIndex + 1} 条单词数据格式不正确。`);
  }
  if (invalidGrammarIndex !== -1) {
    throw new Error(`第 ${invalidGrammarIndex + 1} 条语法数据格式不正确。`);
  }

  if (new Set(data.entries.map((entry) => entry.id)).size !== data.entries.length) {
    throw new Error("单词数据中存在重复 ID。");
  }
  if (new Set(data.grammarEntries.map((entry) => entry.id)).size !== data.grammarEntries.length) {
    throw new Error("语法数据中存在重复 ID。");
  }

  return {
    entries: data.entries.map(normalizeEntry),
    grammarEntries: data.grammarEntries.map(normalizeGrammarEntry),
  };
}

function isValidBackupRecord(record, stringFields, optionalStringFields = []) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (!stringFields.every((field) => typeof record[field] === "string")) return false;
  if (!optionalStringFields.every((field) => {
    return record[field] === undefined || typeof record[field] === "string";
  })) return false;
  if (!record.id.trim() || Number.isNaN(Date.parse(record.createdAt))) return false;
  return record.updatedAt === undefined
    || (typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt)));
}

function downloadPreImportBackup() {
  const data = {
    app: "Mein Deutsch",
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    entries,
    grammarEntries,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `mein-deutsch-before-import-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function restoreStorageSnapshot(snapshot) {
  const values = [
    [STORAGE_KEY, snapshot.permanent],
    [GRAMMAR_STORAGE_KEY, snapshot.grammar],
    [LEGACY_STORAGE_KEYS[0], snapshot.legacy],
  ];

  values.forEach(([key, value]) => {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  });
}

function showSaveStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(showSaveStatus.timer);
  showSaveStatus.timer = window.setTimeout(() => {
    saveStatus.textContent = "数据已安全保存";
  }, 1800);
}

async function initializeApp() {
  if (!IS_PUBLIC_SITE) {
    saveEntries({ backup: false, status: false });
    saveGrammarEntries({ backup: false, status: false });
    render();
    return;
  }

  document.body.classList.add("read-only-mode");
  saveStatus.textContent = "正在载入手机版数据…";
  render();

  try {
    const response = await fetch(`learning-data.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取手机版数据");
    const data = await response.json();
    const publishedData = validateBackupData(data);
    entries = publishedData.entries;
    grammarEntries = publishedData.grammarEntries;
    const publishedAt = data.publishedAt || data.exportedAt;
    saveStatus.textContent = `手机版 · 更新于 ${formatDate(publishedAt)}`;
    render();
  } catch {
    saveStatus.textContent = "手机版数据暂时无法载入";
    render();
  }
}

async function speakGermanWord(text, emptyMessage) {
  const word = text.trim();
  if (!word) {
    alert(emptyMessage);
    return;
  }

  const requestId = ++pronunciationRequestId;
  stopActivePronunciationAudio();
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  try {
    const audioUrl = await findWiktionaryAudio(word);
    if (requestId !== pronunciationRequestId) return;
    if (!audioUrl) {
      speakGerman(word, emptyMessage);
      return;
    }

    const audio = new Audio(audioUrl);
    let usedFallback = false;
    activePronunciationAudio = audio;

    const fallbackToTts = () => {
      if (usedFallback || requestId !== pronunciationRequestId) return;
      usedFallback = true;
      stopActivePronunciationAudio();
      speakGerman(word, emptyMessage);
    };

    audio.addEventListener("error", fallbackToTts, { once: true });
    audio.addEventListener("ended", () => {
      if (activePronunciationAudio === audio) {
        activePronunciationAudio = null;
      }
    }, { once: true });

    try {
      await audio.play();
    } catch {
      fallbackToTts();
    }
  } catch {
    if (requestId === pronunciationRequestId) {
      speakGerman(word, emptyMessage);
    }
  }
}

async function findWiktionaryAudio(word) {
  const cacheKey = word.normalize("NFC");
  if (pronunciationCache.has(cacheKey)) {
    return pronunciationCache.get(cacheKey);
  }

  const params = new URLSearchParams({
    origin: "*",
    action: "parse",
    page: cacheKey,
    prop: "text",
    redirects: "1",
    format: "json",
    formatversion: "2",
  });
  const response = await fetch(`https://de.wiktionary.org/w/api.php?${params}`);
  if (!response.ok) throw new Error("Wiktionary request failed");

  const data = await response.json();
  const html = data.parse?.text || "";
  const audioUrl = findGermanAudioUrl(html);
  pronunciationCache.set(cacheKey, audioUrl);
  return audioUrl;
}

function findGermanAudioUrl(html) {
  if (!html) return null;

  const documentFragment = new DOMParser().parseFromString(html, "text/html");
  const nodes = documentFragment.querySelectorAll("h2, audio[src], audio source[src], a[href]");
  let inGermanSection = false;
  const audioUrls = [];

  for (const node of nodes) {
    if (node.tagName === "H2") {
      if (inGermanSection) break;
      inGermanSection = /\bDeutsch\b/i.test(node.textContent || "");
      continue;
    }

    if (!inGermanSection) continue;
    const value = node.getAttribute("src") || node.getAttribute("href");
    if (!value) continue;

    const url = new URL(value, "https://de.wiktionary.org");
    const isWikimediaAudio = url.protocol === "https:"
      && url.hostname === "upload.wikimedia.org"
      && /\.(?:ogg|oga|mp3|wav|flac|opus|webm)$/i.test(url.pathname);
    if (isWikimediaAudio && !audioUrls.includes(url.href)) {
      audioUrls.push(url.href);
    }
  }

  return audioUrls.find((url) => /\.mp3$/i.test(new URL(url).pathname))
    || audioUrls[0]
    || null;
}

function stopActivePronunciationAudio() {
  if (!activePronunciationAudio) return;
  activePronunciationAudio.pause();
  activePronunciationAudio.currentTime = 0;
  activePronunciationAudio = null;
}

function speakGerman(text, emptyMessage = "这条记录里还没有可以发音的德语内容。") {
  pronunciationRequestId += 1;
  stopActivePronunciationAudio();

  if (!("speechSynthesis" in window)) {
    alert("这个浏览器暂时不支持发音功能。");
    return;
  }

  if (!text.trim()) {
    alert(emptyMessage);
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = 0.86;
  utterance.pitch = 1;

  const germanVoice = speechSynthesis
    .getVoices()
    .find((voice) => voice.lang.toLowerCase().startsWith("de"));

  if (germanVoice) {
    utterance.voice = germanVoice;
  }

  speechSynthesis.speak(utterance);
}


function isValidEntry(entry) {
  return entry
    && entry.id
    && entry.createdAt;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function displaySource(entry) {
  if (entry.book && entry.lesson) {
    return `${entry.book} · ${formatLesson(entry.lesson)}`;
  }

  if (entry.book) {
    return entry.book;
  }

  if (entry.level && entry.lesson) {
    return `${entry.level} · ${formatLesson(entry.lesson)}`;
  }

  if (entry.level) {
    return entry.level;
  }

  if (entry.category) {
    return entry.category;
  }

  return "未设置来源";
}

function formatLesson(value) {
  const lesson = String(value).trim();
  if (!lesson) return "";
  return /^\d+$/.test(lesson) ? `第${lesson}课` : lesson;
}

initializeApp();
