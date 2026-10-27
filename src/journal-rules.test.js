"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DB_JOURNAL_QUERY,
  journalDayFromDate,
  cutoffJournalDay,
  selectFileJournals,
  selectDbJournals,
  blockText,
  isEmptyBlock,
  isPageEmpty,
  trimTargetBlocks,
  isBuiltinPropertyKey,
  hasUserPropertyValue,
  hasIncomingLink,
  emptyJournalDecision,
  journalLabel,
  pageName,
} = require("./journal-rules.js");

const today = new Date(2026, 9, 27);

test("journal day uses the local calendar date", () => {
  assert.equal(journalDayFromDate(new Date(2026, 0, 5)), 20260105);
  assert.equal(journalDayFromDate(today), 20261027);
});

test("look-back window drops today, older days, and pages without a journal day", () => {
  const pages = [
    { name: "today", "journal?": true, journalDay: 20261027 },
    { name: "yesterday", "journal?": true, "journal-day": 20261026 },
    { name: "edge", journal: true, journalDay: 20261017 },
    { name: "too-old", "journal?": true, journalDay: 20261016 },
    { name: "future", "journal?": true, journalDay: 20261028 },
    { name: "not-journal", "journal?": false, journalDay: 20261026 },
    { name: "no-day", "journal?": true },
  ];

  assert.deepEqual(
    selectFileJournals(pages, today, 10).map((page) => page.name),
    ["yesterday", "edge", "future"]
  );
  assert.deepEqual(
    selectFileJournals(pages, today, 0).map((page) => page.name),
    ["yesterday", "edge", "too-old", "future"]
  );
  assert.equal(cutoffJournalDay(today, 10), 20261017);
  assert.equal(cutoffJournalDay(today, 0), null);
});

test("DB query rows use journal-day and skip recycled pages via the query itself", () => {
  assert.match(DB_JOURNAL_QUERY, /:block\/journal-day/);
  assert.match(DB_JOURNAL_QUERY, /:logseq.property\/deleted-at/);
  assert.doesNotMatch(DB_JOURNAL_QUERY, /:block\/journal\?/);

  const rows = [
    [{ name: "oct 26th, 2026", title: "Oct 26th, 2026", "journal-day": 20261026 }],
    [null],
    { name: "today", title: "Oct 27th, 2026", "journal-day": 20261027 },
    [{ name: "old", "journal-day": 20260101 }],
  ];

  assert.deepEqual(
    selectDbJournals(rows, today, 10).map((page) => page.name),
    ["oct 26th, 2026"]
  );
});

test("block text prefers non-blank content, then title", () => {
  assert.equal(blockText({ content: "  hello  ", title: "ignored" }), "hello");
  assert.equal(blockText({ content: "   ", title: " from title " }), "from title");
  assert.equal(blockText({ content: "", title: "" }), "");
  assert.equal(blockText({ title: "db only" }), "db only");
  assert.equal(blockText({ content: "file only" }), "file only");
  assert.equal(blockText(null), "");
  assert.equal(blockText(["uuid", 1]), "");
});

test("a page is empty only when the whole tree has no text", () => {
  assert.equal(isPageEmpty(null), false);
  assert.equal(isPageEmpty([]), true);
  assert.equal(isPageEmpty([{ content: "   " }, { content: "" }]), true);
  assert.equal(
    isPageEmpty([{ content: "", children: [{ content: "kept" }] }]),
    false
  );
  assert.equal(
    isPageEmpty([{ content: "   ", title: "   ", children: [{ content: "  " }] }]),
    true
  );
  assert.equal(isPageEmpty([{ content: "", children: [["uuid-tuple"]] }]), false);
  assert.equal(isEmptyBlock({ content: "", children: [{ content: "x" }] }), false);
  assert.equal(isEmptyBlock({ content: "   ", title: "note" }), false);
});

test("trim targets are leading and trailing blank blocks, never a fully blank page", () => {
  const blocks = [
    { uuid: "a", content: "" },
    { uuid: "b", content: "  " },
    { uuid: "c", content: "note" },
    { uuid: "d", content: "", children: [{ content: "child" }] },
    { uuid: "e", title: "   ", content: "" },
  ];
  assert.deepEqual(
    trimTargetBlocks(blocks).map((block) => block.uuid),
    ["a", "b", "e"]
  );
  assert.deepEqual(trimTargetBlocks([{ uuid: "a", content: "" }, { uuid: "b", content: " " }]), []);
  assert.deepEqual(trimTargetBlocks(null), []);
  assert.deepEqual(trimTargetBlocks([]), []);
});

test("built-in property keys and empty values do not count as user data", () => {
  assert.equal(isBuiltinPropertyKey(":logseq.property/created-at"), true);
  assert.equal(isBuiltinPropertyKey("logseq.class/Journal"), true);
  assert.equal(isBuiltinPropertyKey(":logseq.task/status"), true);
  assert.equal(isBuiltinPropertyKey("block/updated-at"), true);
  assert.equal(isBuiltinPropertyKey(":user.property/mood"), false);
  assert.equal(isBuiltinPropertyKey("mood"), false);

  const builtin = {
    ":logseq.property/created-at": 1710000000000,
    ":logseq.property/updated-at": 1710000000000,
    ":block/tags": ["Journal"],
    ":block/journal-day": 20261026,
    mood: "   ",
    alias: [],
    emptyObj: {},
  };
  assert.equal(hasUserPropertyValue(builtin, []), false);
  assert.equal(hasUserPropertyValue({ ":user.property/mood": "ok" }, []), true);
  assert.equal(hasUserPropertyValue({ rating: 0 }, []), true);
  assert.equal(hasUserPropertyValue({ done: false }, []), true);
  assert.equal(
    hasUserPropertyValue(null, [{ content: "", properties: { place: "home" }, children: [] }]),
    true
  );
  assert.equal(
    hasUserPropertyValue({}, [{ content: "", children: [{ properties: { note: "" } }] }]),
    false
  );
});

test("incoming links ignore the journal itself", () => {
  const self = [[{ name: "oct 26th, 2026" }, [{ content: "[[Oct 26th, 2026]]" }]]];
  assert.equal(hasIncomingLink(self, "oct 26th, 2026"), false);
  assert.equal(hasIncomingLink(null, "oct 26th, 2026"), false);
  assert.equal(
    hasIncomingLink(
      [
        [{ name: "oct 26th, 2026" }, [{ content: "self" }]],
        [{ name: "Meetings" }, [{ content: "[[Oct 26th, 2026]]" }]],
      ],
      "Oct 26th, 2026"
    ),
    true
  );
  assert.equal(hasIncomingLink([[{ name: "Meetings" }, []]], "oct 26th, 2026"), false);
});

test("property protection and backlink protection decide whether an empty journal is deleted", () => {
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "present",
      keepBacklinks: false,
      backlinkState: "absent",
    }),
    "properties"
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "unknown",
      keepBacklinks: false,
      backlinkState: "absent",
    }),
    "properties-unreadable"
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: false,
      propertyState: "present",
      keepBacklinks: false,
      backlinkState: "present",
    }),
    null
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "absent",
      keepBacklinks: false,
      backlinkState: "present",
    }),
    null
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "absent",
      keepBacklinks: true,
      backlinkState: "present",
    }),
    "backlinks"
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "absent",
      keepBacklinks: true,
      backlinkState: "unknown",
    }),
    "backlinks-unreadable"
  );
  assert.equal(
    emptyJournalDecision({
      keepProperties: true,
      propertyState: "absent",
      keepBacklinks: true,
      backlinkState: "absent",
    }),
    null
  );
});

test("labels prefer title and deletion still needs the page name", () => {
  assert.equal(journalLabel({ title: "Oct 26th, 2026", name: "oct 26th, 2026" }), "Oct 26th, 2026");
  assert.equal(journalLabel({ name: "oct 26th, 2026" }), "oct 26th, 2026");
  assert.equal(pageName({ name: "oct 26th, 2026" }), "oct 26th, 2026");
  assert.equal(pageName({ title: "Oct 26th, 2026" }), null);
  assert.equal(pageName({ name: "" }), null);
});
