// Creates the Langfuse score configs that /api/feedback references, unless they already exist,
// and prints their IDs for .env.local. Run once per Langfuse project:
//   node --env-file=.env.local scripts/create-score-configs.mjs
// Configs can't be edited: to change one, archive it in Langfuse, run this again and update the ID.
import { LangfuseClient } from "@langfuse/client";

const CONFIGS = [
  {
    env: "LANGFUSE_REPLY_RATING_CONFIG_ID",
    name: "reply_rating",
    dataType: "BOOLEAN",
    description: "Thumbs up (true) or down (false) from the user on one reply. Comment: what went wrong, if they said.",
  },
  {
    env: "LANGFUSE_REPLY_RATING_REASON_CONFIG_ID",
    name: "reply_rating_reason",
    dataType: "CATEGORICAL",
    // Keep in step with REPLY_RATING_REASONS in src/lib/feedback-limits.ts.
    categories: [
      { label: "wrong_place", value: 0 },
      { label: "bad_route", value: 1 },
      { label: "wrong_time", value: 2 },
      { label: "other", value: 3 },
    ],
    description:
      "Why the user rated a reply down. wrong_place: resolved the wrong stop or suburb. bad_route: poor journey choices or ranking. wrong_time: misread depart/arrive or the date. other: anything else.",
  },
];

const langfuse = new LangfuseClient();

const existing = [];
for (let page = 1; ; page++) {
  const { data, meta } = await langfuse.api.scoreConfigs.get({ page, limit: 100 });
  existing.push(...data);
  if (page >= meta.totalPages) break;
}

for (const { env, ...config } of CONFIGS) {
  let found = existing.find((c) => c.name === config.name && c.dataType === config.dataType && !c.isArchived);
  if (found) {
    console.error(`${config.name}: already exists`);
  } else {
    found = await langfuse.api.scoreConfigs.create(config);
    console.error(`${config.name}: created`);
  }
  console.log(`${env}=${found.id}`);
}
