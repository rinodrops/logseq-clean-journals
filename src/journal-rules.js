"use strict";

// Datascript query for DB graphs only. :logseq.property/deleted-at is not in
// the file-graph schema, so this must not be sent to OG 0.10.
const DB_JOURNAL_QUERY = `[:find (pull ?p [:block/uuid :block/name :block/title :block/journal-day])
 :where
 [?p :block/journal-day ?d]
 [(missing? $ ?p :logseq.property/deleted-at)]]`;

function journalDayFromDate(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function cutoffJournalDay(today, daysBack) {
  const n = parseInt(daysBack, 10) || 0;
  if (n <= 0) return null;
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  return journalDayFromDate(cutoff);
}

function journalDayOf(page) {
  if (!page || typeof page !== "object") return null;
  const jday = page["journal-day"] ?? page.journalDay;
  return typeof jday === "number" ? jday : null;
}

function inLookbackWindow(jday, todayJDay, cutoffJDay) {
  if (jday == null) return false;
  if (jday === todayJDay) return false;
  if (cutoffJDay != null && jday < cutoffJDay) return false;
  return true;
}

function isFileJournal(page) {
  if (!page || typeof page !== "object") return false;
  const isJournal = page["journal?"] ?? page.journal ?? false;
  if (!isJournal) return false;
  return journalDayOf(page) != null;
}

function selectInWindow(pages, today, daysBack) {
  const todayJDay = journalDayFromDate(today);
  const cutoffJDay = cutoffJournalDay(today, daysBack);
  return pages.filter((page) => inLookbackWindow(journalDayOf(page), todayJDay, cutoffJDay));
}

function selectFileJournals(pages, today, daysBack) {
  return selectInWindow((pages || []).filter(isFileJournal), today, daysBack);
}

function pagesFromQueryRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (Array.isArray(row) ? row[0] : row))
    .filter((page) => page && typeof page === "object");
}

function selectDbJournals(rows, today, daysBack) {
  return selectInWindow(pagesFromQueryRows(rows), today, daysBack);
}

function blockText(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return "";
  const content = typeof block.content === "string" ? block.content : "";
  const title = typeof block.title === "string" ? block.title : "";
  const raw = content.trim() !== "" ? content : title;
  return raw.trim();
}

function isEmptyBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  if (Array.isArray(block.children) && block.children.length > 0) return false;
  return blockText(block) === "";
}

function blockHasContent(block) {
  if (Array.isArray(block)) return block.length > 0;
  if (!block || typeof block !== "object") return false;
  if (blockText(block) !== "") return true;
  if (Array.isArray(block.children) && block.children.some(blockHasContent)) return true;
  return false;
}

// null / non-arrays mean the page could not be resolved, not that it is empty.
function isPageEmpty(blocks) {
  if (!Array.isArray(blocks)) return false;
  return !blocks.some(blockHasContent);
}

function trimTargetBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const targets = [];
  for (let i = 0; i < blocks.length; i++) {
    if (isEmptyBlock(blocks[i])) targets.push(blocks[i]);
    else break;
  }

  // A fully blank page is left for the deletion pass.
  if (targets.length === blocks.length) return [];

  for (let i = blocks.length - 1; i >= 0; i--) {
    if (isEmptyBlock(blocks[i])) targets.push(blocks[i]);
    else break;
  }
  return targets;
}

function pageName(page) {
  return typeof page?.name === "string" && page.name !== "" ? page.name : null;
}

function journalLabel(page) {
  if (!page || typeof page !== "object") return "";
  if (typeof page.title === "string" && page.title.trim() !== "") return page.title;
  if (typeof page.name === "string" && page.name !== "") return page.name;
  const jday = journalDayOf(page);
  if (jday != null) return String(jday);
  return page.uuid ? String(page.uuid) : "";
}

module.exports = {
  DB_JOURNAL_QUERY,
  journalDayFromDate,
  cutoffJournalDay,
  journalDayOf,
  inLookbackWindow,
  isFileJournal,
  selectFileJournals,
  selectDbJournals,
  pagesFromQueryRows,
  blockText,
  isEmptyBlock,
  isPageEmpty,
  trimTargetBlocks,
  pageName,
  journalLabel,
};
