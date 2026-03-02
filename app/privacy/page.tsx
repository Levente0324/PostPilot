import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Adatvédelmi Tájékoztató",
  description: "A PostRocket adatvédelmi tájékoztatója.",
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "2026. március 2.";

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          ← Vissza a főoldalra
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Adatvédelmi Tájékoztató
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Utolsó frissítés: {lastUpdated}
        </p>

        <div className="mt-10 space-y-8 text-gray-700 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              1. Adatkezelő
            </h2>
            <p>
              A PostRocket (a továbbiakban: „Szolgáltatás") üzemeltetője (a
              továbbiakban: „Adatkezelő") felelős a felhasználók személyes
              adatainak kezeléséért. A Szolgáltatás a{" "}
              <strong>postrocket.hu</strong> domain alatt érhető el.
            </p>
            <p className="mt-2">
              Kapcsolat:{" "}
              <a
                href="mailto:hello@postrocket.hu"
                className="text-blue-600 hover:underline"
              >
                hello@postrocket.hu
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              2. Milyen adatokat gyűjtünk?
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Regisztrációs adatok:</strong> e-mail cím, teljes név
                (amennyiben megadásra kerül).
              </li>
              <li>
                <strong>Közösségi média fiókok:</strong> Facebook oldal és
                Instagram üzleti fiók adatai (oldal neve, fiók azonosítók),
                amelyeket a felhasználó önkéntesen csatlakoztat a Meta OAuth
                folyamaton keresztül.
              </li>
              <li>
                <strong>Hozzáférési tokenek:</strong> a Meta (Facebook/Instagram)
                API-hoz szükséges hozzáférési tokenek, amelyeket AES-256-GCM
                titkosítással tárolunk az adatbázisban.
              </li>
              <li>
                <strong>Felhasználói tartalom:</strong> a felhasználó által
                létrehozott posztok szövege és feltöltött képei.
              </li>
              <li>
                <strong>Számlázási adatok:</strong> a Stripe fizetési szolgáltató
                kezeli a bankkártya adatokat — mi kizárólag a Stripe ügyfél
                azonosítót és az előfizetési státuszt tároljuk.
              </li>
              <li>
                <strong>Használati adatok:</strong> rate limiting célú naplóbejegyzések
                (felhasználói azonosító, művelet típusa, időbélyeg). Ezek 90 nap
                után automatikusan törlésre kerülnek.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              3. Az adatkezelés célja és jogalapja
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Szolgáltatás nyújtása</strong> (szerződés teljesítése —
                GDPR 6. cikk (1) b)): regisztráció, bejelentkezés, posztok
                ütemezése és közzététele a csatlakoztatott közösségi média
                felületeken.
              </li>
              <li>
                <strong>Fizetés feldolgozása</strong> (szerződés teljesítése):
                előfizetési csomagok kezelése a Stripe-on keresztül.
              </li>
              <li>
                <strong>Visszaélés-megelőzés</strong> (jogos érdek — GDPR 6. cikk
                (1) f)): rate limiting és használati naplózás.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              4. Adatfeldolgozók és harmadik felek
            </h2>
            <p>A Szolgáltatás az alábbi harmadik fél szolgáltatókat veszi igénybe:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                <strong>Supabase</strong> (adatbázis, autentikáció, fájltárolás)
                — az EU-ban tárolt adatokkal.
              </li>
              <li>
                <strong>Vercel</strong> (webhosting) — a weboldal kiszolgálásáért
                felelős.
              </li>
              <li>
                <strong>Stripe</strong> (fizetés feldolgozás) — bankkártya adatokat
                kizárólag a Stripe kezeli, a PostRocket nem tárolja azokat.
              </li>
              <li>
                <strong>Meta Platforms (Facebook, Instagram)</strong> — a
                csatlakoztatott közösségi média fiókok kezelése és posztok
                közzététele.
              </li>
              <li>
                <strong>Google (Gemini AI)</strong> — AI-alapú posztszöveg
                generálás. A felhasználó által megadott prompt és üzleti
                kontextus kerül továbbításra, személyes azonosító adatok nem.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              5. Adatmegőrzés
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                A felhasználói fiók és a kapcsolódó adatok a fiók törléséig
                megőrzésre kerülnek.
              </li>
              <li>
                A használati naplóbejegyzések (usage_logs) 90 nap után
                automatikusan törlésre kerülnek.
              </li>
              <li>
                A feltöltött képek a poszt közzététele vagy törlése után
                eltávolításra kerülnek a tárolóból.
              </li>
              <li>
                A Meta hozzáférési tokenek a közösségi média fiók lecsatlakoztatásakor
                azonnal törlésre kerülnek.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              6. Felhasználói jogok (GDPR)
            </h2>
            <p>
              Az Európai Unió Általános Adatvédelmi Rendelete (GDPR) alapján
              Önnek joga van:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Hozzáférést kérni a tárolt adataihoz.</li>
              <li>Adatai helyesbítését kérni.</li>
              <li>Adatai törlését kérni („elfeledtetéshez való jog").</li>
              <li>Az adatkezelés korlátozását kérni.</li>
              <li>Adathordozhatóságot kérni.</li>
              <li>Tiltakozni az adatkezelés ellen.</li>
            </ul>
            <p className="mt-2">
              Jogai gyakorlásához kérjük, lépjen velünk kapcsolatba a{" "}
              <a
                href="mailto:hello@postrocket.hu"
                className="text-blue-600 hover:underline"
              >
                hello@postrocket.hu
              </a>{" "}
              e-mail címen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              7. Adatbiztonság
            </h2>
            <p>
              A PostRocket az iparági szabványoknak megfelelő biztonsági
              intézkedéseket alkalmaz:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Minden kapcsolat HTTPS (TLS) titkosítással védett.</li>
              <li>
                A Meta hozzáférési tokenek AES-256-GCM titkosítással kerülnek
                tárolásra.
              </li>
              <li>
                Az adatbázis soralapú biztonsági szabályokkal (Row Level Security)
                van védve — a felhasználók kizárólag saját adataikhoz férhetnek
                hozzá.
              </li>
              <li>
                A Stripe webhook-ok aláírás-ellenőrzéssel és idempotencia
                védelemmel rendelkeznek.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              8. Cookie-k
            </h2>
            <p>
              A Szolgáltatás kizárólag a működéshez szükséges cookie-kat
              használ (autentikációs munkamenet cookie-k). Nem használunk
              harmadik féltől származó nyomkövető cookie-kat, analitikai
              cookie-kat vagy reklámcélú cookie-kat.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              9. Módosítások
            </h2>
            <p>
              Az Adatkezelő fenntartja a jogot, hogy jelen adatvédelmi
              tájékoztatót bármikor módosítsa. A módosított verzió a weboldalon
              való közzététellel válik hatályossá. A lényeges változásokról a
              felhasználókat e-mailben értesítjük.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              10. Kapcsolat
            </h2>
            <p>
              Adatvédelmi kérdések esetén kérjük, keressen minket az alábbi
              elérhetőségen:
            </p>
            <p className="mt-2">
              E-mail:{" "}
              <a
                href="mailto:hello@postrocket.hu"
                className="text-blue-600 hover:underline"
              >
                hello@postrocket.hu
              </a>
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-gray-200 pt-8">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← Vissza a főoldalra
          </Link>
        </div>
      </div>
    </div>
  );
}
