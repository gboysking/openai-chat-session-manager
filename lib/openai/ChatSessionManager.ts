import axios from "axios";
import { ChatSessionDynamoDBTable } from "./ChatSessionDynamoDBTable";
import { encoding_for_model, TiktokenModel } from "@dqbd/tiktoken";
import stream from "stream";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface ChatMessage {
    role: "user" | "assistant";
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
}

export class ChatSessionManager {
    private session: ChatSession;
    private max_tokens: number;
    private temperature: number;

    constructor(options: ChatSessionManagerOptions) {
        if (options.session == null) {
            this.session = new ChatSessionDynamoDBTable({ table: "chat" });
        } else {
            this.session = options.session;
        }

        this.max_tokens = options.max_tokens ? options.max_tokens : 50;
        this.temperature = options.temperature ? options.temperature : 1.0;
    }

    async getAnswer(sessionId: string, prompt: string, model: string = "gpt-3.5-turbo"): Promise<ChatMessage[]> {

        let history: ChatData | null = await this.session.getItem(sessionId);

        if (history == null) {
            history = { sessionId: sessionId, created: new Date().getTime(), messages: [], totalTokens: 0 };
        } else {
            history.lastUpdate = new Date().getTime();
        }

        let userMessage: ChatMessage = { role: "user", content: prompt, created: new Date().getTime() };

        const apiUrl = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        };

        const messages = history.messages.map((msg) => ({ role: msg.role, content: msg.content }));

        const data = {
            model: model,
            messages: [...messages, { role: userMessage.role, content: userMessage.content }],
            max_tokens: this.max_tokens,
            n: 1,
            stop: null,
            temperature: this.temperature,
        };

        try {
            const response = await axios.post(apiUrl, data, { headers });

            const content = response.data.choices[0].message.content;
            const promptTokens = response.data.usage.prompt_tokens;
            const completionTokens = response.data.usage.completion_tokens;
            const totalTokens = response.data.usage.total_tokens;

            let assistantMessage: ChatMessage = { role: "assistant", content: content, token: completionTokens, created: new Date().getTime() };
            userMessage.token = promptTokens;
            history.messages.push(userMessage);
            history.messages.push(assistantMessage);
            history.totalTokens += totalTokens;

            await this.session.putItem(sessionId, history);
            return history.messages;
        } catch (error) {
            console.error('Error while fetching data from OpenAI API:', error);
            throw error;
        }
    }

    async getAnswerStream(sessionId: string, prompt: string, model: TiktokenModel = "gpt-3.5-turbo") {
        let history = await this.session.getItem(sessionId);

        if (history == null) {
            history = { sessionId, created: new Date().getTime(), messages: [], totalTokens: 0 };
        } else {
            history.lastUpdate = new Date().getTime();
        }

        const encoder = encoding_for_model(model);

        let tokens = encoder.encode(prompt);

        const userMessage: ChatMessage = { role: 'user', content: prompt, created: new Date().getTime(), token: tokens.length };
        
        history.totalTokens += userMessage.token;

        const apiUrl = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
        };

        const messages = history.messages.map((msg) => ({ role: msg.role, content: msg.content }));

        const data = {
            model,
            messages: [...messages, { role: userMessage.role, content: userMessage.content }],
            max_tokens: this.max_tokens,
            n: 1,
            stop: null,
            temperature: this.temperature,
            stream: true
        };

        try {
            const response = await axios.post(apiUrl, data, {
                headers,
                responseType: 'stream',
            });

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: '',
                token: 0,
                created: 0,
            };

            history.messages.push(userMessage);
            history.messages.push(assistantMessage);

            let buffer = '';
            let done = false;
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
                            assistantMessage.token = encoder.encode(assistantMessage.content).length;
                            history.totalTokens += assistantMessage.token;

                            encoder.free();
                            done = true;
                            break;
                        }

                        try {
                            const json = JSON.parse(line.substring(6));

                            if (assistantMessage.created == 0) {
                                assistantMessage.created = new Date().getTime();
                            }

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
                if ( done == false) {
                    assistantMessage.token = encoder.encode(assistantMessage.content).length;
                    history.totalTokens += assistantMessage.token;
                    encoder.free();
                    await this.session.putItem(sessionId, history);
                }                
            });

            dataStream.on('finish', async () => {
                await this.session.putItem(sessionId, history);
            });

            response.data.pipe(dataStream);

            return dataStream;
        } catch (error) {
            console.error('Error while fetching data from OpenAI API:', error);
            throw error;
        }
    }
}

