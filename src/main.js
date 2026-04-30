import "@logseq/libs";

async function deleteEmptyJournals() {
  const settings = logseq.settings || {};
  const daysBack = parseInt(settings.daysBack ?? 10, 10) || 0;
  const dryRun = settings.dryRun ?? false;

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
  console.log(`Target count: ${count}`);
  if (count > 0) console.log("Targets:", targets);
  console.groupEnd();

  if (dryRun) {
    if (count > 0) {
      const list = targets.map((n) => `- ${n}`).join("\n");
      logseq.App.showMsg(
        `DRY RUN MODE. Nothing was deleted.\n\n` +
          `${count} empty journal(s) would be deleted${rangeLabel}:\n` +
          `${list}\n\n` +
          `To actually delete, uncheck "Dry run" in plugin settings.`,
        "warning",
        { timeout: 0 }
      );
    } else {
      logseq.App.showMsg(
        `DRY RUN MODE. Nothing was deleted.\n\n` +
          `No empty journals found${rangeLabel}.`,
        "warning",
        { timeout: 0 }
      );
    }
  } else {
    logseq.App.showMsg(
      count > 0
        ? `Deleted ${count} empty journal(s)${rangeLabel}.`
        : `No empty journals found${rangeLabel}.`,
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
      default: false,
      title: "Dry run",
      description: "If enabled, only counts empty journals without deleting them.",
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
