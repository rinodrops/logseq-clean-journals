import "@logseq/libs";

function isEmptyBlock(block) {
  if (!block) return false;
  if (block.children && block.children.length > 0) return false;
  if (block.properties && Object.keys(block.properties).length > 0) return false;

  // `title` is canonical in DB graphs; `content` is its deprecated alias.
  // If neither is present, this may be a DB property-value helper block.
  const text = block.title ?? block.content;
  return typeof text === "string" && text.trim() === "";
}

function journalLabel(page) {
  return page.title || page.name || String(page["journal-day"] ?? page.journalDay ?? page.uuid);
}

async function getJournals() {
  const rows = await logseq.DB.datascriptQuery(`
    [:find (pull ?page [:block/uuid :block/name :block/title :block/journal-day])
     :where
     [?page :block/journal-day]
     [(missing? $ ?page :logseq.property/deleted-at)]]
  `);

  // Datascript :find results are rows, with the pulled page as the first value.
  return (rows || []).map((row) => Array.isArray(row) ? row[0] : row).filter(Boolean);
}

async function trimJournalPage(page, dryRun) {
  const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
  if (!blocks || blocks.length === 0) return 0;

  const trimTargets = [];

  // Leading empty blocks
  for (let i = 0; i < blocks.length; i++) {
    if (isEmptyBlock(blocks[i])) trimTargets.push(blocks[i]);
    else break;
  }

  // Stop if every block is empty (the page itself is empty;
  // leave it for the page-deletion pass to handle).
  if (trimTargets.length === blocks.length) return 0;

  // Trailing empty blocks
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (isEmptyBlock(blocks[i])) trimTargets.push(blocks[i]);
    else break;
  }

  if (!dryRun) {
    for (const b of trimTargets) {
      await logseq.Editor.removeBlock(b.uuid);
    }
  }
  return trimTargets.length;
}

async function deleteEmptyJournals() {
  const settings = logseq.settings || {};
  const daysBack = parseInt(settings.daysBack ?? 10, 10) || 0;
  const dryRun = settings.dryRun ?? false;
  const trimEmptyBlocks = settings.trimEmptyBlocks ?? false;

  const today = new Date();
  const todayJDay =
    today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();

  // Compute cutoff as a journal-day integer (YYYYMMDD) to match Logseq's
  // representation and avoid timezone drift.
  let cutoffJDay = null;
  if (daysBack > 0) {
    const c = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
    cutoffJDay = c.getFullYear() * 10000 + (c.getMonth() + 1) * 100 + c.getDate();
  }

  const pages = await getJournals();
  const journals = pages
    .filter((p) => {
      const jday = p["journal-day"] ?? p.journalDay;
      if (!jday) return false;
      if (jday === todayJDay) return false;
      if (cutoffJDay !== null && jday < cutoffJDay) return false;
      return true;
    })
    .sort((a, b) =>
      (a["journal-day"] ?? a.journalDay) - (b["journal-day"] ?? b.journalDay)
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
  for (const page of journals) {
    const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
    // `null` means the page could not be resolved, not that it is empty.
    const isEmpty = Array.isArray(blocks) && (blocks.length === 0 || blocks.every(isEmptyBlock));
    if (isEmpty) {
      if (!dryRun) await logseq.Editor.deletePage(page.uuid);
      targets.push(journalLabel(page));
    }
  }

  const count = targets.length;
  const rangeLabel = daysBack > 0 ? ` (last ${daysBack} days)` : "";

  console.group("[logseq-clean-journals]");
  console.log(`Mode: ${dryRun ? "Dry run" : "Delete"}`);
  console.log(`Range: ${daysBack > 0 ? `last ${daysBack} days` : "all"}`);
  if (trimEmptyBlocks) {
    console.log(`Trimmed empty blocks: ${trimmedBlockCount} across ${trimmedPages.length} page(s)`);
    if (trimmedPages.length > 0) console.log("Trimmed pages:", trimmedPages);
  }
  console.log(`Deleted page count: ${count}`);
  if (count > 0) console.log("Deleted targets:", targets);
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
