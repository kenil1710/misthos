"use client";

/**
 * Last resort when the root layout itself fails: no app styles are guaranteed, so this stays self-contained. Same
 * stone + emerald palette, light and dark (from the system setting, since the theme script may not have run).
 */
const CSS = `
:root { color-scheme: light dark; --bg:#fafaf9; --card:#ffffff; --fg:#1c1917; --soft:#57534e; --brand:#1f6b52; --on:#fafaf9; }
@media (prefers-color-scheme: dark) { :root { --bg:#121110; --card:#1b1a19; --fg:#ecebe9; --soft:#c7c4c0; --brand:#62b598; --on:#0f241c; } }
body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { max-width:520px; margin:16px; padding:32px; border-radius:24px; background:var(--card);
  box-shadow: 0 1px 2px rgb(0 0 0 / .05), 0 12px 32px -16px rgb(0 0 0 / .2); }
h1 { font-family: ui-serif, Georgia, serif; font-weight:400; font-size:36px; line-height:1.1; margin:0; letter-spacing:-.01em; }
p { color:var(--soft); font-size:15px; line-height:1.6; margin:12px 0 0; }
button { margin-top:20px; height:36px; padding:0 16px; border:0; border-radius:10px; background:var(--brand);
  color:var(--on); font:500 14px/1 inherit; font-family:inherit; cursor:pointer; }
button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
`;

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Misthos couldn&apos;t load</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main className="card" role="alert">
          <h1>Misthos couldn&apos;t load</h1>
          <p>
            It couldn&apos;t reach its database or the Arc network just now. Your data is safe;
            nothing was changed.
          </p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
