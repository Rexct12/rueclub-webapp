"use client";

import { useState } from "react";
import { jsonErrorMessage, readResponseJson } from "@/lib/fetch-json";

export function LoginForm() {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, pin }),
    });

    setLoading(false);
    if (!response.ok) {
      const data = await readResponseJson(response);
      setError(jsonErrorMessage(data) || "Login gagal.");
      return;
    }

    window.location.href = "/";
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Nama
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Naufal"
          autoComplete="username"
        />
      </label>
      <label>
        PIN
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="6 digit PIN"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" disabled={loading}>
        {loading ? "Memeriksa..." : "Masuk"}
      </button>
    </form>
  );
}

