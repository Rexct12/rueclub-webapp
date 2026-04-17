import "server-only";

// Kita gunakan library resmi Google
import { GoogleGenerativeAI } from "@google/generative-ai";
import { aiDraftSchema, todayInBangkok, type AiDraft, type AppData } from "@/lib/domain";
import { parseRupiah } from "@/lib/format";

const prompt = `You convert Indonesian finance notes into strict JSON for a RueClub finance app.
Supported intents: capitalDeposit, expense, participantPayment.
Return only JSON. No markdown.
Rules:
- "modal" or "modal titipan" means capitalDeposit.
- "expense", "biaya", "bayar court", "parkir", "bensin", "dokumentasi" means expense.
- "bayar", "pembayaran", player names with session and amount usually means participantPayment.
- Convert "1 juta" to 1000000 and "450 ribu" to 450000.
- Use YYYY-MM-DD date or "today" if no date.
- confidence is 0 to 1.
- missingFields contains required fields that cannot be inferred.
Fields: intent, date, amount, accountName, sessionCode, playerName, category, method, status, description, notes, confidence, missingFields.`;

function extractJson(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : trimmed;
}

// Ini adalah mesin cadangan jika Google AI mati/error
function ruleBasedDraft(input: string): AiDraft {
  const text = input.toLowerCase();
  const isCapital = /modal|titipan/.test(text);
  const isExpense = /expense|biaya|court|parkir|bensin|dokumentasi|aset|admin/.test(text);
  const intent = isCapital ? "capitalDeposit" : isExpense ? "expense" : "participantPayment";
  const bcaNura = /bca\s+nura/.test(text);
  const bcaNaufal = /bca\s+naufal/.test(text);
  const jago = /\bjago\b/.test(text);
  const amountMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(juta|ribu)?|rp\s*[\d.,]+/);
  const sessionMatch = input.match(/([a-zA-Z]+(?:\s+[a-zA-Z]+)?[-\s]?\d{3})/);
  const amount = amountMatch ? parseRupiah(amountMatch[0]) : undefined;

  return aiDraftSchema.parse({
    intent,
    date: "today",
    amount,
    accountName: bcaNura ? "BCA Nura" : bcaNaufal ? "BCA Naufal" : jago ? "Jago" : undefined,
    sessionCode: sessionMatch?.[1]?.replace(/\s+(\d{3})$/, "-$1"),
    playerName: intent === "participantPayment" ? input.split(/\s+/)[0] : undefined,
    category: intent === "expense" ? "Court" : undefined,
    method: /free|gratis|belum/.test(text) ? undefined : /cash/.test(text) ? "Cash" : "Transfer",
    status: /belum/.test(text) ? "Belum" : /free|gratis/.test(text) ? "Free" : "Lunas",
    description: intent === "capitalDeposit" ? "Modal titipan" : input,
    notes: input,
    confidence: amount ? 0.72 : 0.45,
    missingFields: [],
  });
}

function enrichDraft(draft: AiDraft, data: AppData): AiDraft {
  const missing = new Set(draft.missingFields);
  const date = !draft.date || draft.date === "today" ? todayInBangkok() : draft.date;
  if (!draft.amount) missing.add("amount");
  return { ...draft, date, missingFields: [...missing] };
}

// INI FUNGSI UTAMA UNTUK MENGGUNAKAN GOOGLE GEMINI
export async function draftQuickEntry(input: string, data: AppData) {
  if (!input.trim()) throw new Error("Input kosong.");

  // Mengambil kunci dari file .env
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  
  // Jika kunci tidak ada, pakai mesin cadangan (ruleBasedDraft)
  if (!apiKey) {
    return enrichDraft(ruleBasedDraft(input), data);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Kita gunakan model gemini-1.5-flash yang cepat dan gratis
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const promptLengkap = `${prompt}
Known accounts: ${data.accounts.map((a) => a.name).join(", ")}
Known sessions: ${data.sessions.map((s) => s.code).join(", ")}
User input: ${input}`;

    const result = await model.generateContent(promptLengkap);
    const response = await result.response;
    const rawText = response.text();
    
    const parsed = JSON.parse(extractJson(rawText));
    return enrichDraft(aiDraftSchema.parse(parsed), data);
  } catch (error) {
    console.error("Gagal konek ke Google AI, pakai cadangan:", error);
    return enrichDraft(ruleBasedDraft(input), data);
  }
}