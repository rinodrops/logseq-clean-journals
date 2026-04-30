import "@logseq/libs";

async function deleteEmptyJournals() {
  const settings = logseq.settings || {};
  const daysBack = parseInt(settings.daysBack ?? 30, 10) || 0;
  const dryRun = settings.dryRun ?? true;

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

  let count = 0;
  for (const page of journals) {
    const blocks = await logseq.Editor.getPageBlocksTree(page.name);
    const isEmpty =
      !blocks ||
      blocks.length === 0 ||
      (blocks.length === 1 && (!blocks[0].content || blocks[0].content.trim() === ""));
    if (isEmpty) {
      if (!dryRun) await logseq.Editor.deletePage(page.name);
      count++;
    }
  }

  const rangeLabel = daysBack > 0 ? ` (last ${daysBack} days)` : "";
  const dryLabel = dryRun ? " [Dry run]" : "";
  logseq.App.showMsg(
    count > 0
      ? `${dryLabel}Deleted ${count} empty journal(s)${rangeLabel}.`
      : `${dryLabel}No empty journals found${rangeLabel}.`
  );
}

function main() {
  logseq.useSettingsSchema([
    {
      key: "daysBack",
      type: "number",
      default: 30,
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
