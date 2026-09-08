import type { ChatMessageData, ChatSource } from "../types/chat";

type ApiChatResponse = {
	answer: string;
	sources: ChatSource[];
	confidence: "high" | "medium" | "low";
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function sendChatMessage(message: string, history: ChatMessageData[]): Promise<ApiChatResponse> {
	let response: Response;
	try {
		response = await fetch(`${apiUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message,
				history: history.map(({ role, content }) => ({ role, content })),
			}),
		});
	} catch {
		throw new Error("Unable to reach the assistant service. Check that the backend is running.");
	}

	if (!response.ok) {
		const error = await response.json().catch(() => null) as { detail?: string } | null;
		throw new Error(error?.detail ?? "The assistant is temporarily unavailable.");
	}

	const payload = await response.json().catch(() => null) as Partial<ApiChatResponse> | null;
	if (!payload || typeof payload.answer !== "string" || !Array.isArray(payload.sources)) {
		throw new Error("The assistant returned an invalid response.");
	}
	return payload as ApiChatResponse;
}
