import "@logseq/libs";
import {
  DB_JOURNAL_QUERY,
  cutoffJournalDay,
  emptyJournalDecision,
  hasIncomingLink,
  hasUserPropertyValue,
  isPageEmpty,
  journalDayFromDate,
  journalLabel,
  pageName,
  selectDbJournals,
  selectFileJournals,
  trimTargetBlocks,
} from "./journal-rules.js";

async function currentGraphIsDb() {
  const check = logseq.App && logseq.App.checkCurrentIsDbGraph;
  if (typeof check !== "function") return false;
  try {
    return Boolean(await check());
  } catch (err) {
    console.warn("[logseq-clean-journals] DB graph check failed; using file-graph lookup.", err);
    return false;
  }
}

async function listJournals(today, daysBack) {
  if (await currentGraphIsDb()) {
    const rows = await logseq.DB.datascriptQuery(DB_JOURNAL_QUERY);
    return selectDbJournals(rows, today, daysBack);
  }

  const pages = await logseq.Editor.getAllPages();
  return selectFileJournals(pages, today, daysBack);
}

async function pageBlocks(page) {
  const name = pageName(page);
  if (!name) return null;
  return logseq.Editor.getPageBlocksTree(name);
}

async function trimJournalPage(page, dryRun) {
  const blocks = await pageBlocks(page);
  const targets = trimTargetBlocks(blocks);
  if (!dryRun) {
    for (const block of targets) {
      if (block.uuid) await logseq.Editor.removeBlock(block.uuid);
    }
  }
  return targets.length;
}

async function propertyStateFor(name, blocks) {
  const read = logseq.Editor && logseq.Editor.getPageProperties;
  if (typeof read !== "function") return "unknown";
  try {
    const pageProps = await read(name);
    return hasUserPropertyValue(pageProps, blocks) ? "present" : "absent";
  } catch (err) {
    console.warn("[logseq-clean-journals] Property lookup failed; keeping the page.", name, err);
    return "unknown";
  }
}

async function backlinkStateFor(name) {
  const read = logseq.Editor && logseq.Editor.getPageLinkedReferences;
  if (typeof read !== "function") return "unknown";
  try {
    const refs = await read(name);
    if (refs == null) return "unknown";
    return hasIncomingLink(refs, name) ? "present" : "absent";
  } catch (err) {
    console.warn("[logseq-clean-journals] Backlink lookup failed; keeping the page.", name, err);
    return "unknown";
  }
}

async function deleteEmptyJournals() {
  const settings = logseq.settings || {};
  const daysBack = parseInt(settings.daysBack ?? 10, 10) || 0;
  const dryRun = settings.dryRun ?? false;
  const trimEmptyBlocks = settings.trimEmptyBlocks ?? false;
  const keepProperties = settings.keepJournalsWithProperties !== false;
  const keepBacklinks = settings.keepJournalsWithBacklinks === true;

  const today = new Date();
  const journals = (await listJournals(today, daysBack)).sort(
    (a, b) => (a["journal-day"] ?? a.journalDay ?? 0) - (b["journal-day"] ?? b.journalDay ?? 0)
  );

  // Trim leading/trailing empty blocks first, so a page that becomes empty
  // can still be picked up by the deletion pass below.
  let trimmedBlockCount = 0;
  const trimmedPages = [];
  if (trimEmptyBlocks) {
    for (const page of journals) {
      const n = await trimJournalPage(page, dryRun);
      if (n > 0) {
        trimmedBlockCount += n;
        trimmedPages.push({ name: journalLabel(page), count: n });
      }
    }
  }

  const targets = [];
  const kept = [];
  for (const page of journals) {
    const name = pageName(page);
    if (!name) continue;
    const blocks = await logseq.Editor.getPageBlocksTree(name);
    if (!isPageEmpty(blocks)) continue;
    const propertyState = keepProperties ? await propertyStateFor(name, blocks) : "absent";
    const backlinkState = keepBacklinks ? await backlinkStateFor(name) : "absent";
    const reason = emptyJournalDecision({
      keepProperties,
      propertyState,
      keepBacklinks,
      backlinkState,
    });
    if (reason) {
      kept.push({ name: journalLabel(page), reason });
      continue;
    }
    if (!dryRun) await logseq.Editor.deletePage(name);
    targets.push(journalLabel(page));
  }

  const count = targets.length;
  const rangeLabel = daysBack > 0 ? ` (last ${daysBack} days)` : "";

  console.group("[logseq-clean-journals]");
  console.log(`Mode: ${dryRun ? "Dry run" : "Delete"}`);
  console.log(`Range: ${daysBack > 0 ? `last ${daysBack} days` : "all"}`);
  console.log(`Today: ${journalDayFromDate(today)}`);
  console.log(`Cutoff: ${cutoffJournalDay(today, daysBack) ?? "none"}`);
  if (trimEmptyBlocks) {
    console.log(`Trimmed empty blocks: ${trimmedBlockCount} across ${trimmedPages.length} page(s)`);
    if (trimmedPages.length > 0) console.log("Trimmed pages:", trimmedPages);
  }
  console.log(`Deleted page count: ${count}`);
  if (count > 0) console.log("Deleted targets:", targets);
  console.log(`Kept page count: ${kept.length}`);
  if (kept.length > 0) console.log("Kept pages:", kept);
  console.groupEnd();

  const trimSummary = trimEmptyBlocks
    ? (trimmedBlockCount > 0
        ? `${trimmedBlockCount} empty block(s) ${dryRun ? "would be trimmed" : "trimmed"} from ${trimmedPages.length} page(s).\n\n`
        : `No leading/trailing empty blocks found${rangeLabel}.\n\n`)
    : "";

  if (dryRun) {
    if (count > 0) {
      const list = targets.map((n) => `- ${n}`).join("\n");
      logseq.App.showMsg(
        `DRY RUN MODE. Nothing was changed.\n\n` +
          trimSummary +
          `${count} empty journal(s) would be deleted${rangeLabel}:\n` +
          `${list}\n\n` +
          `To actually apply changes, uncheck "Dry run" in plugin settings.`,
        "warning",
        { timeout: 0 }
      );
    } else {
      logseq.App.showMsg(
        `DRY RUN MODE. Nothing was changed.\n\n` +
          trimSummary +
          `No empty journals found${rangeLabel}.`,
        "warning",
        { timeout: 0 }
      );
    }
  } else {
    logseq.App.showMsg(
      (count > 0
        ? `Deleted ${count} empty journal(s)${rangeLabel}.`
        : `No empty journals found${rangeLabel}.`) +
        (trimEmptyBlocks
          ? (trimmedBlockCount > 0
              ? `\nTrimmed ${trimmedBlockCount} empty block(s) from ${trimmedPages.length} page(s).`
              : `\nNo leading/trailing empty blocks found.`)
          : ""),
      "success"
    );
  }
}

function main() {
  logseq.useSettingsSchema([
    {
      key: "daysBack",
      type: "number",
      default: 10,
      title: "Days to look back",
      description: "How many past days to scan for empty journals. Set to 0 to scan all.",
    },
    {
      key: "dryRun",
      type: "boolean",
      default: true,
      title: "Dry run",
      description: "If enabled, only counts empty journals without deleting them. Turn off to actually delete.",
    },
    {
      key: "trimEmptyBlocks",
      type: "boolean",
      default: false,
      title: "Trim leading/trailing empty blocks",
      description: "If enabled, also remove consecutive empty blocks at the top and bottom of each in-scope journal page. Today's journal is excluded. Empty blocks in the middle are preserved.",
    },
    {
      key: "keepJournalsWithProperties",
      type: "boolean",
      default: true,
      title: "Keep journals that have properties",
      description: "When enabled, a journal with a user-defined property value is not deleted even if its blocks are blank. Built-in values such as created time are ignored.",
    },
    {
      key: "keepJournalsWithBacklinks",
      type: "boolean",
      default: false,
      title: "Keep journals that have backlinks",
      description: "When enabled, a journal linked from another page is not deleted even if its blocks are blank.",
    },
  ]);

  logseq.App.registerUIItem("toolbar", {
    key: "clean-empty-journals",
    template: `
      <a class="button" data-on-click="cleanJournals" title="Delete empty journals">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </a>
    `,
  });

  logseq.provideModel({
    async cleanJournals() {
      await deleteEmptyJournals();
    },
  });
}

logseq.ready(main).catch(console.error);
