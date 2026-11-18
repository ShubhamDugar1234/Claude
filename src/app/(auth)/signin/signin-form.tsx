"use client";
import { useActionState, useEffect, useRef } from "react";
import { requestCode, verifyCode, type SignInState } from "./actions";

const input =
  "w-full rounded-lg border border-neutral-300 px-3 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const button =
  "w-full rounded-lg bg-brand px-4 py-3 text-base font-medium text-white disabled:opacity-60";

export function SignInForm({ initialError }: { initialError?: string }) {
  const [emailState, emailAction, sending] = useActionState(requestCode, {
    step: "email",
    error: initialError,
  } satisfies SignInState);
  const [codeState, codeAction, checking] = useActionState(verifyCode, {
    step: "code",
  } satisfies SignInState);
  const codeRef = useRef<HTMLInputElement>(null);

  const onCodeStep = emailState.step === "code" && codeState.step === "code";
  const email = codeState.email ?? emailState.email;

  useEffect(() => {
    if (codeState.redirectTo) window.location.assign(codeState.redirectTo);
  }, [codeState.redirectTo]);

  useEffect(() => {
    if (onCodeStep) codeRef.current?.focus();
  }, [onCodeStep, emailState]);

  if (!onCodeStep) {
    return (
      <form action={emailAction} className="space-y-4" noValidate>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Company email</span>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="you@mvdugar.com"
            defaultValue={emailState.email}
            required
            className={input}
          />
        </label>
        {emailState.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {emailState.error}
          </p>
        )}
        <button type="submit" disabled={sending} className={button}>
          {sending ? "Sending code…" : "Send me a code"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        {emailState.info}
      </p>
      <form action={codeAction} className="space-y-4" noValidate>
        <input type="hidden" name="email" value={email ?? ""} />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">6-digit code</span>
          <input
            ref={codeRef}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            placeholder="123 456"
            required
            className={`${input} text-center text-2xl tracking-[0.3em]`}
          />
        </label>
        {codeState.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {codeState.error}
          </p>
        )}
        <button type="submit" disabled={checking || !!codeState.redirectTo} className={button}>
          {checking || codeState.redirectTo ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <form action={emailAction}>
          <input type="hidden" name="email" value={email ?? ""} />
          <button
            type="submit"
            disabled={sending}
            className="text-brand underline-offset-2 hover:underline"
          >
            {sending ? "Sending…" : "Send a new code"}
          </button>
        </form>
        <a href="/signin" className="text-neutral-600 underline-offset-2 hover:underline">
          Use a different email
        </a>
      </div>
    </div>
  );
}
