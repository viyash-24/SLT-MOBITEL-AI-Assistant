export type ChatRole = "user" | "assistant";

export type ChatMessageData = {
	id: string;
	role: ChatRole;
	content: string;
	time: string;
	kind?: "fibre" | "roaming";
	confidence?: string;
	sources?: ChatSource[];
};

export type ChatSource = {
	title: string;
	category: string;
};
