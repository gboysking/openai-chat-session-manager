import axios, { isAxiosError } from "axios";
import { ChatSessionDynamoDBTable } from "./ChatSessionDynamoDBTable";
import { encoding_for_model, Tiktoken, TiktokenModel } from "@dqbd/tiktoken";
import stream from "stream";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    token?: number;
    created?: number;
}

export interface ChatData {
    sessionId: string;
    created: number;
    lastUpdate?: number;
    totalTokens: number;
    messages: ChatMessage[];
}

export abstract class ChatSession {
    abstract putItem(sessionId: string, data: Omit<ChatData, 'sessionId'>): Promise<void>;
    abstract getItem(sessionId: string): Promise<ChatData | null>;
    abstract deleteItem(sessionId: string): Promise<void>;
}

export interface ChatSessionManagerOptions {
    session?: ChatSession;
    max_tokens?: number;
    temperature?: number;
    api_key?: string;
    extractMessages?: (messages: ChatMessage[],
        messageTokens: number,
        maxRequestTokens: number,
        encoder?: Tiktoken) => { messages: ChatMessage[], tokenSum: number };
}

function calculateTokenSum(messages: ChatMessage[], encoder?: Tiktoken): number {
    if (encoder) {
        const conv_messages = messages.map((msg) => ({ role: msg.role, content: msg.content }));
        const tokens = conv_messages.map((message) => encoder.encode(JSON.stringify(message)).length);
        const tokenSum = tokens.reduce((sum, value) => sum + value + 2, 0);
        messages.map((msg, index) => { msg.token = tokens[index] });
        return tokenSum;
    } else {
        const tokenValues = messages.map((message) => message.token || 0);
        const tokenSum = tokenValues.reduce((sum, value) => sum + value + 2, 0);
        return tokenSum;
    }
}

function extractMessagesWithinTokenLimit(
    messages: ChatMessage[],
    messageTokens: number,
    maxRequestTokens: number,
    encoder?: Tiktoken,
): { messages: ChatMessage[], tokenSum: number } {
    let tokenSum = calculateTokenSum(messages, encoder);
    while (tokenSum + messageTokens > maxRequestTokens) {
        const deletedMessage = messages.shift();
        if (deletedMessage) {
            const deletedMessageTokens = (deletedMessage.token || 0) + 2;
            tokenSum -= (deletedMessageTokens);
        } else {
            break; // No more messages to delete
        }
    }

    return { messages, tokenSum };
}

function requestMaxTokens(model: TiktokenModel = "gpt-3.5-turbo"): number {
    switch (model) {
        case "gpt-3.5-turbo":
            return 4096;
        case "gpt-4":
            return 8192;
        default:
            throw new Error("Unsupported model");
    }
}

export class ChatSessionManager {
    private session: ChatSession;
    private options: ChatSessionManagerOptions;

    constructor(options: ChatSessionManagerOptions) {
        if (options.session == null) {
            this.session = new ChatSessionDynamoDBTable({ table: "chat" });
        } else {
            this.session = options.session;
        }

        this.options = { ...options };

        this.options.max_tokens = this.options.max_tokens || 50;
        this.options.temperature = this.options.temperature || 1.0;

    }

    async getAnswer(sessionId: string, message: string, model: TiktokenModel = "gpt-3.5-turbo", options?: ChatSessionManagerOptions): Promise<ChatData> {

        let history: ChatData | null = await this.session.getItem(sessionId);

        if (history == null) {
            history = { sessionId: sessionId, created: new Date().getTime(), messages: [], totalTokens: 0 };
        } else {
            history.lastUpdate = new Date().getTime();
        }

        const encoder = encoding_for_model(model);
        const newMessage: ChatMessage = { role: "user", content: message };
        const newMessageTokens = encoder.encode(JSON.stringify(newMessage)).length;

        let userMessage: ChatMessage = { ...newMessage, created: new Date().getTime() };

        const apiUrl = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.api_key || OPENAI_API_KEY}`,
        };

        try {
            let extractMessage = options.extractMessages ? options.extractMessages([...history.messages], newMessageTokens, requestMaxTokens(model) - (options?.max_tokens || this.options.max_tokens) - 100, encoder)
                : extractMessagesWithinTokenLimit([...history.messages], newMessageTokens, requestMaxTokens(model) - (options?.max_tokens || this.options.max_tokens) - 100, encoder);
            const messages = extractMessage.messages.map((msg) => ({ role: msg.role, content: msg.content }));

            const data = {
                model: process.env.MODEL_VERSION ? model + "-" + process.env.MODEL_VERSION : model,
                messages: [...messages, { role: userMessage.role, content: userMessage.content }],
                max_tokens: options?.max_tokens || this.options.max_tokens,
                n: 1,
                stop: null,
                temperature: options?.max_tokens || this.options.temperature,
            };

            const response = await axios.post(apiUrl, data, { headers, timeout: 10 * 1000 });

            const content = response.data.choices[0].message.content;
            const completionTokens = response.data.usage.completion_tokens;
            const totalTokens = response.data.usage.total_tokens;

            let assistantMessage: ChatMessage = { role: "assistant", content: content, token: completionTokens, created: new Date().getTime() };
            userMessage.token = newMessageTokens;
            history.messages.push(userMessage);
            history.messages.push(assistantMessage);
            history.totalTokens = totalTokens;

            await this.session.putItem(sessionId, history);
            return history;
        } catch (error) {
            if (isAxiosError(error) && error?.response?.data?.error) {
                console.error('Error while fetching data from OpenAI API:', error.response.data.error);
            } else {
                console.error('Error while fetching data from OpenAI API:', error);
            }

            throw error;
        }
    }

    async getAnswerStream(sessionId: string, message: string, model: TiktokenModel = "gpt-3.5-turbo", options?: ChatSessionManagerOptions, callback?: (data: ChatData) => void) {
        let history = await this.session.getItem(sessionId);

        if (history == null) {
            history = { sessionId, created: new Date().getTime(), messages: [], totalTokens: 0 };
        } else {
            history.lastUpdate = new Date().getTime();
        }

        const encoder = encoding_for_model(model);
        const newMessage: ChatMessage = { role: "user", content: message };
        const newMessageTokens = encoder.encode(JSON.stringify(newMessage)).length;
        const userMessage: ChatMessage = { ...newMessage, created: new Date().getTime(), token: newMessageTokens };

        history.totalTokens = userMessage.token;

        const apiUrl = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.api_key || OPENAI_API_KEY}`,
        };

        try {
            let extractMessage = options.extractMessages ? options.extractMessages([...history.messages], newMessageTokens, requestMaxTokens(model) - (options?.max_tokens || this.options.max_tokens) - 100, encoder)
                : extractMessagesWithinTokenLimit([...history.messages], newMessageTokens, requestMaxTokens(model) - (options?.max_tokens || this.options.max_tokens) - 100, encoder);
            const messages = extractMessage.messages.map((msg) => ({ role: msg.role, content: msg.content }));
            history.totalTokens += extractMessage.tokenSum;

            const data = {
                model: process.env.MODEL_VERSION ? model + "-" + process.env.MODEL_VERSION : model,
                messages: [...messages, { role: userMessage.role, content: userMessage.content }],
                max_tokens: options?.max_tokens || this.options.max_tokens,
                n: 1,
                stop: null,
                temperature: options?.temperature || this.options.temperature,
                stream: true
            };

            const response = await axios.post(apiUrl, data, {
                headers,
                responseType: 'stream',
                timeout: 5 * 1000
            });

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: ''
            };

            let created = new Date().getTime();

            history.messages.push(userMessage);
            history.messages.push(assistantMessage);

            let buffer = '';
            let tokenCaculate = false;
            let saved = false;
            // Use a stream to handle the incoming data
            const dataStream = new stream.Transform({
                transform(chunk, encoding, next) {
                    let str = chunk.toString();
                    this.push(str);

                    buffer += str;
                    let lineEndIndex: number;

                    while ((lineEndIndex = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, lineEndIndex);
                        buffer = buffer.slice(lineEndIndex + 1);

                        if (line.length === 0) continue; // ignore empty message
                        if (line.startsWith(':')) continue; // ignore sse comment message

                        if (line === 'data: [DONE]') {
                            assistantMessage.token = encoder.encode(JSON.stringify(assistantMessage)).length;
                            history.totalTokens += assistantMessage.token;
                            history.created = created;

                            encoder.free();
                            tokenCaculate = true;
                            break;
                        }

                        try {
                            const json = JSON.parse(line.substring(6));

                            const delta = json.choices[0].delta.content;

                            if (delta) {
                                assistantMessage.content += delta;
                            }

                        } catch (err) {
                            console.error(err);
                        }
                    };

                    next();
                },
            });

            dataStream.on('close', async () => {
                if (tokenCaculate == false) {
                    assistantMessage.token = encoder.encode(JSON.stringify(assistantMessage)).length;
                    history.totalTokens += assistantMessage.token;
                    history.created = created;
                    encoder.free();
                    tokenCaculate = true;
                }

                if (saved == false) {
                    saved = true;
                    await this.session.putItem(sessionId, history);

                    if (callback) {
                        callback(history);
                    }

                }
            });
            dataStream.on('finish', async () => {
                if (tokenCaculate == false) {
                    assistantMessage.token = encoder.encode(JSON.stringify(assistantMessage)).length;
                    history.totalTokens += assistantMessage.token;
                    history.created = created;
                    encoder.free();
                    tokenCaculate = true;
                }

                if (saved == false) {
                    saved = true;
                    await this.session.putItem(sessionId, history);

                    if (callback) {
                        callback(history);
                    }
                }
            });

            response.data.pipe(dataStream);

            return dataStream;
        } catch (error) {
            if (isAxiosError(error)) {
                console.log(error.toJSON());
                console.error('Error while fetching data from OpenAI API');
            }

            throw error;
        }
    }
}

