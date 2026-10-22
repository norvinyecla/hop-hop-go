import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy · hop-hop-go",
  description: "What hop-hop-go does with your messages and ratings",
};

export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8 text-base leading-relaxed">
      <h1 className="text-lg font-semibold">Privacy note</h1>
      <p>
        hop-hop-go has no accounts, and doesn&rsquo;t use cookies or analytics. Your chat isn&rsquo;t saved in
        the browser: reloading the page starts a new one.
      </p>

      <h2 className="font-semibold">What happens to your messages</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Each message, with the rest of the conversation, is sent to the AI model provider that writes the replies
          (Google or Anthropic, depending on how the app is set up).
        </li>
        <li>Places and times you ask about are sent to Transport for NSW to find stops and trips.</li>
        <li>
          Messages, replies and the steps in between are recorded with Langfuse, a tracing service, so we can find
          and fix bad answers.
        </li>
      </ul>

      <h2 className="font-semibold">Ratings and comments</h2>
      <p>
        When you rate a reply, the rating, any reason you pick and any comment you write are stored in Langfuse
        alongside that reply. Please don&rsquo;t include names, addresses or other personal details in comments.
      </p>

      <h2 className="font-semibold">Other data</h2>
      <p>
        Your IP address is used to limit how many requests one person can send. It&rsquo;s kept in server memory
        only, for at most a day.
      </p>

      <h2 className="font-semibold">How long data is kept</h2>
      <p>
        Recorded conversations, ratings and comments are stored with Langfuse (Japan region) and aren&rsquo;t deleted
        automatically. We delete them on request.
      </p>

      <h2 className="font-semibold">Contact</h2>
      {/* Spelled out rather than a mailto: link, to keep the address away from scrapers. */}
      <p>Questions or deletion requests: email ngydev [at] outlook.com.</p>
    </main>
  );
}
