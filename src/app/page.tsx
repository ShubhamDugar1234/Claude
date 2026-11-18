import Image from "next/image";

// Placeholder home page for M0. Replaced by sign-in / chat in M2–M3.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Image src="/logo.svg" alt="MV Dugar Group" width={72} height={72} priority />
      <h1 className="text-2xl font-semibold">MV Dugar AI Portal</h1>
      <p className="text-sm text-neutral-500">Making Visions and Dreams. Since 1884.</p>
    </main>
  );
}
