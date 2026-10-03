"use client";
// ── "ADD THIS TO YOUR HOME SCREEN", ASKED AT THE ONLY MOMENT IT IS A REASONABLE THING TO ASK.
//
// Not on first visit. Someone who has just arrived has no idea whether they want this app on
// their phone, and asking then is the banner everybody dismisses reflexively — which also burns
// the ONE `beforeinstallprompt` event Chrome gives us. It is asked after a list exists, because
// a person with a list is a person about to walk into a shop.
//
// ── THE TWO PLATFORMS SHARE NOTHING HERE, which is why this is not one code path.
//
//   Android Chrome  fires `beforeinstallprompt`. We keep the event and call `.prompt()` on a
//                   tap. The browser draws the dialog; we cannot.
//   iOS Safari      NEVER fires it, and has no API at all. The only route is Share → "Adaugă
//                   la ecranul principal", so the only honest thing to do is TELL the person
//                   that, with the actual menu wording, and get out of the way.
//
// Detected by capability and by platform, not by user-agent sniffing for a browser NAME: the
// question is "can this device install a web app, and how", which is what is tested.
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISSED = "cosmic_install_dismissed";
/** Long enough that a dismissal is respected for a real shopping cycle, not forever. */
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function alreadyInstalled(): boolean {
  if (typeof window === "undefined") return false;
  // `standalone` is the iOS signal; the media query is everyone else's.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as a Mac, so touch points are what separates it from a desktop Safari.
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function InstallPrompt({ ready }: { ready: boolean }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (alreadyInstalled()) return;
    try {
      const at = Number(localStorage.getItem(DISMISSED) ?? 0);
      if (at && Date.now() - at < SNOOZE_MS) return;
    } catch { /* a blocked store must not break the page */ }

    setHidden(false);

    const onBip = (e: Event) => {
      // Chrome shows its own mini-infobar unless this is prevented; we want the ask to come at
      // OUR moment, not on arrival.
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    if (isIos()) setShowIos(true);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* ignore */ }
    setDeferred(null);
    setShowIos(false);
    setHidden(true);
  };

  // `ready` is the caller saying a list exists. Nothing renders before that.
  if (hidden || !ready) return null;
  if (!deferred && !showIos) return null;

  return (
    <div className="install-sheet" role="dialog" aria-label="Adaugă pe telefon">
      <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>📲</span>
      <div style={{ flex: 1 }}>
        {showIos ? (
          <>
            <p><b>Pune CosIeftin pe ecranul principal.</b></p>
            <p className="muted">
              Apasă <b>Partajează</b> în bara Safari, apoi <b>„Adaugă la ecranul principal”</b>.
              Lista rămâne disponibilă și fără semnal, în magazin.
            </p>
          </>
        ) : (
          <>
            <p><b>Pune CosIeftin pe ecranul principal.</b></p>
            <p className="muted">Se deschide direct pe listă și merge și fără semnal, în magazin.</p>
          </>
        )}
        <div className="install-actions">
          {deferred && (
            <button
              type="button"
              className="btn btn-accent"
              onClick={async () => {
                // The event can only be used ONCE. Dropped either way, so a second tap cannot
                // call a spent prompt and silently do nothing.
                const e = deferred;
                setDeferred(null);
                try { await e.prompt(); await e.userChoice; } catch { /* the browser decides */ }
                dismiss();
              }}
            >
              Adaugă
            </button>
          )}
          <button type="button" className="linklike" onClick={dismiss}>Nu acum</button>
        </div>
      </div>
    </div>
  );
}
