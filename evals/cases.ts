import type { AvoidableMode } from "@/lib/avoid";
import type { Preference } from "@/lib/rank";

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

/** A Sydney day relative to when the case's fixtures were recorded. A weekday is the next one, or today. */
export type RelativeDay = "today" | "tomorrow" | Weekday;

/** What a reply has to do. Anything left out isn't checked. */
export type Expectations = {
  /** Places resolveLocation must be asked about. Each matches any query containing it, ignoring case. */
  resolves?: string[];
  /** false: planTrip must not be called. Otherwise its last call must match. */
  planTrip?:
    | false
    | {
        /** null: nothing left out. */
        avoid?: AvoidableMode[] | null;
        preference?: Preference;
        /** null: leaves now. */
        when?: { type: "depart" | "arrive"; day: RelativeDay; time: string } | null;
      };
  /** false: getServiceAlerts must not be called. Otherwise it must be, with these lines and days if given. */
  alerts?: false | { lines?: string[]; from?: RelativeDay; to?: RelativeDay };
  /** The reply asks the user something instead of planning a trip. */
  asksFollowUp?: boolean;
  /** No tool is called at all. */
  noTools?: boolean;
};

export type EvalCase = {
  /** Kebab-case. Names the fixture file and the Langfuse dataset item. */
  id: string;
  /** What the case is about, for people reading results. */
  description: string;
  /** The chat so far, ending with the user's message. Earlier turns are plain text, as the model sees them. */
  messages: { role: "user" | "assistant"; content: string }[];
  expect: Expectations;
};

const user = (content: string) => [{ role: "user" as const, content }];

/**
 * Hand-written cases. Add one for every reply people rate down that a check could have caught.
 * After adding or changing one, record its fixtures: EVAL_RECORD=1 EVAL_CASES=<id> npm run eval.
 */
export const CASES: EvalCase[] = [
  {
    id: "simple-trip",
    description: "A plain A-to-B trip, leaving now, with every mode.",
    messages: user("How do I get from Central to Bondi Junction?"),
    expect: { resolves: ["central", "bondi junction"], planTrip: { avoid: null, when: null, preference: "balanced" } },
  },
  {
    id: "fastest",
    description: "Asking for the fastest trip sets the preference.",
    messages: user("What's the fastest way from Parramatta to Circular Quay?"),
    expect: { resolves: ["parramatta", "circular quay"], planTrip: { preference: "fastest", avoid: null } },
  },
  {
    id: "fewest-changes",
    description: "Asking for fewest changes sets the preference.",
    messages: user("Chatswood to the airport with the fewest changes please"),
    expect: { resolves: ["chatswood", "airport"], planTrip: { preference: "fewest-changes", avoid: null } },
  },
  {
    id: "least-walking",
    description: "Walking can't be avoided, so not wanting to walk means least-walking, not avoid.",
    messages: user("I don't want to walk much. Town Hall to Newtown?"),
    expect: { resolves: ["town hall", "newtown"], planTrip: { preference: "least-walking", avoid: null } },
  },
  {
    id: "no-buses",
    description: "Leaving out one mode.",
    messages: user("Redfern to Randwick, no buses"),
    expect: { resolves: ["redfern", "randwick"], planTrip: { avoid: ["bus"] } },
  },
  {
    id: "no-metro-keeps-trains",
    description: "Avoiding the metro leaves Sydney Trains in.",
    messages: user("Epping to Central, but not on the metro"),
    expect: { resolves: ["epping", "central"], planTrip: { avoid: ["metro"] } },
  },
  {
    id: "trains-only",
    description: "Trains only leaves out metro, light rail and buses.",
    messages: user("Strathfield to Hornsby, trains only"),
    expect: { resolves: ["strathfield", "hornsby"], planTrip: { avoid: ["metro", "light rail", "bus"] } },
  },
  {
    id: "avoids-every-mode",
    description: "Ruling out every mode gets a reply that one has to stay in, not a search.",
    messages: user("Central to Bondi Junction, but no trains, no metro, no light rail and no buses"),
    expect: { planTrip: false },
  },
  {
    id: "arrive-by-tomorrow",
    description: "An arrive-by time tomorrow.",
    messages: user("I need to be at Macquarie University by 9am tomorrow. I'm leaving from Wynyard."),
    expect: {
      resolves: ["macquarie university", "wynyard"],
      planTrip: { when: { type: "arrive", day: "tomorrow", time: "09:00" } },
    },
  },
  {
    id: "depart-tomorrow",
    description: "A leave-at time tomorrow, in 12-hour time.",
    messages: user("Leaving Penrith tomorrow at 6:30am for Martin Place"),
    expect: {
      resolves: ["penrith", "martin place"],
      planTrip: { when: { type: "depart", day: "tomorrow", time: "06:30" } },
    },
  },
  {
    id: "vague-time",
    description: "A vague time gets a follow-up question instead of a guess.",
    messages: user("Hurstville to Bondi Junction tomorrow morning"),
    expect: { planTrip: false, asksFollowUp: true },
  },
  {
    id: "ambiguous-place",
    description: "A destination that could be many places gets a follow-up question.",
    messages: user("How do I get from Central to the beach?"),
    expect: { planTrip: false, asksFollowUp: true },
  },
  {
    id: "outside-sydney",
    description: "A trip that ends outside Sydney isn't planned.",
    messages: user("How do I get from Central to Melbourne by train?"),
    expect: { planTrip: false },
  },
  {
    id: "weekend-trackwork",
    description: "Trackwork on a line this weekend checks alerts from Saturday to Sunday.",
    messages: user("Is there any trackwork on the T1 this weekend?"),
    expect: { alerts: { lines: ["T1"], from: "saturday", to: "sunday" }, planTrip: false },
  },
  {
    id: "bus-disruptions",
    description: "Alerts don't cover buses, so a bus question doesn't call getServiceAlerts.",
    messages: user("Are there any disruptions on the 333 bus today?"),
    expect: { alerts: false, planTrip: false },
  },
  {
    id: "off-topic",
    description: "A question that isn't about getting around Sydney calls no tools.",
    messages: user("What's the weather going to be like in Sydney tomorrow?"),
    expect: { noTools: true },
  },
  {
    id: "avoid-carries-over",
    description: "A mode left out earlier stays out for the next trip in the chat.",
    messages: [
      { role: "user", content: "Redfern to Randwick, no buses please" },
      {
        role: "assistant",
        content:
          "I'd take the train from Redfern to Central, then the L2 light rail to Randwick. It takes about 35 minutes with one change.",
      },
      { role: "user", content: "Great. And from Randwick to Bondi Junction after that?" },
    ],
    expect: { resolves: ["randwick", "bondi junction"], planTrip: { avoid: ["bus"] } },
  },
  {
    id: "avoid-lifted",
    description: "Once the user says a mode is fine again, it's back in.",
    messages: [
      { role: "user", content: "Redfern to Randwick, no buses please" },
      {
        role: "assistant",
        content:
          "I'd take the train from Redfern to Central, then the L2 light rail to Randwick. It takes about 35 minutes with one change.",
      },
      { role: "user", content: "Actually buses are fine now. Randwick to Bondi Junction?" },
    ],
    expect: { resolves: ["randwick", "bondi junction"], planTrip: { avoid: null } },
  },
];
