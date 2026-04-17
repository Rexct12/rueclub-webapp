import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { LoginForm } from "@/app/login/LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="eyebrow">RueClub Finance</p>
        <h1>Masuk untuk mencatat transaksi.</h1>
        <p className="muted">
          Gunakan akun admin yang sudah dibuat lewat script seed. Data produksi disimpan di
          Firestore, sedangkan development bisa memakai local store.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}

