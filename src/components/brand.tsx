import Image from "next/image";

export function Brand({ size = "md" }: { size?: "sm" | "md" }) {
  const px = size === "sm" ? 32 : 56;
  return (
    <div
      className={
        size === "sm" ? "flex items-center gap-2" : "flex flex-col items-center gap-3 text-center"
      }
    >
      <Image src="/logo.svg" alt="" width={px} height={px} priority />
      <div>
        <p className={size === "sm" ? "text-sm font-semibold" : "text-xl font-semibold"}>
          MV Dugar AI Portal
        </p>
        {size === "md" && (
          <p className="text-sm text-neutral-500">Making Visions and Dreams. Since 1884.</p>
        )}
      </div>
    </div>
  );
}
