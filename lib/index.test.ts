import { ChatSessionManager, ChatSession, ChatData } from './openai';
import stream from 'stream';

class MockChatSession extends ChatSession {
  private data: { [key: string]: ChatData } = {};

  async putItem(sessionId: string, data: Omit<ChatData, 'sessionId'>): Promise<void> {
    this.data[sessionId] = { sessionId, ...data };
  }

  async getItem(sessionId: string): Promise<ChatData | null> {
    return this.data[sessionId] || null;
  }

  async deleteItem(sessionId: string): Promise<void> {
    delete this.data[sessionId];
  }
}

describe('ChatSessionManager', () => {
  let chatSessionManager: ChatSessionManager;
  const sessionId = 'test-session';

  beforeEach(() => {
    chatSessionManager = new ChatSessionManager({ session: new MockChatSession() });
  });

  afterEach(async () => {

  });

  test('getAnswer creates a new session if it does not exist', async () => {
    const messages = await chatSessionManager.getAnswer(sessionId, 'What is the capital of France?');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('What is the capital of France?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('Paris');
    console.log(messages);
  });

  test('getAnswer appends messages to an existing session', async () => {
    await chatSessionManager.getAnswer(sessionId, 'What is the capital of France?');
    const messages = await chatSessionManager.getAnswer(sessionId, 'What is the capital of Germany?');
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('What is the capital of Germany?');
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].content).toContain('Berlin');
    console.log(messages);
  });

  test('getAnswerStream creates a new session if it does not exist', async () => {
    const answerStream = await chatSessionManager.getAnswerStream(sessionId, 'What is the capital of France?');

    expect(answerStream).toBeInstanceOf(stream.Writable);

    const chunks = [];
    const testStream = new stream.Writable({
      write(chunk, encoding, next) {
        console.log(chunk);
        chunks.push(chunk);
        next();
      },
    });

    answerStream.pipe(testStream);

    await new Promise((resolve) => {
      testStream.on('finish', resolve);
    });

    const output = Buffer.concat(chunks).toString();

    console.log(output);
  });


  // Add more tests as needed
});
