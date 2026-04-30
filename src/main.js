import "@logseq/libs";

function isEmptyBlock(block) {
  if (!block) return false;
  if (block.children && block.children.length > 0) return false;
  return !block.content || block.content.trim() === "";
}

async function trimJournalPage(page, dryRun) {
  const blocks = await logseq.Editor.getPageBlocksTree(page.name);
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
  const todayStr = today.toISOString().slice(0, 10);

  const cutoff = daysBack > 0
    ? new Date(today.getTime() - daysBack * 86400000)
    : null;

  const pages = await logseq.Editor.getAllPages();
  const journals = (pages || []).filter((p) => {
    if (!p["journal?"] || p.name === todayStr) return false;
    if (cutoff && p["journal-day"]) {
      const d = String(p["journal-day"]);
      const pageDate = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      if (pageDate < cutoff) return false;
    }
    return true;
  });

  // Trim leading/trailing empty blocks first, so a page that becomes empty
  // can still be picked up by the deletion pass below.
  let trimmedBlockCount = 0;
  const trimmedPages = [];
  if (trimEmptyBlocks) {
    for (const page of journals) {
      const n = await trimJournalPage(page, dryRun);
      if (n > 0) {
        trimmedBlockCount += n;
        trimmedPages.push({ name: page.name, count: n });
      }
    }
  }

  const targets = [];
  for (const page of journals) {
    const blocks = await logseq.Editor.getPageBlocksTree(page.name);
    const isEmpty =
      !blocks ||
      blocks.length === 0 ||
      (blocks.length === 1 && (!blocks[0].content || blocks[0].content.trim() === ""));
    if (isEmpty) {
      if (!dryRun) await logseq.Editor.deletePage(page.name);
      targets.push(page.name);
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

  const trimSummary = trimEmptyBlocks && trimmedBlockCount > 0
    ? `${trimmedBlockCount} empty block(s) ${dryRun ? "would be trimmed" : "trimmed"} from ${trimmedPages.length} page(s).\n\n`
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
        (trimEmptyBlocks && trimmedBlockCount > 0
          ? `\nTrimmed ${trimmedBlockCount} empty block(s) from ${trimmedPages.length} page(s).`
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
