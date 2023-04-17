# OpenAI Chat Session Manager

OpenAI Chat Session Manager is a TypeScript module designed to manage chat sessions with an AI model (default : GPT-3.5 Turbo) through the OpenAI API. This module provides a convenient way to store and retrieve chat histories, utilizing AWS DynamoDB for storage.

## Features

- Communicates with the OpenAI API to send chat messages and receive AI-generated responses
- Stores chat histories in AWS DynamoDB
- Supports custom session storage implementations

## Prerequisites

You need to have your OpenAI API key to use this module. Set up an environment variable `OPENAI_API_KEY` with your API key:

```bash
export OPENAI_API_KEY="your_openai_api_key"
```

## Installation

```bash
npm install axios aws-sdk
```

## Usage

```typescript
import { ChatSessionManager } from "./ChatSessionManager";

const chatSessionManager = new ChatSessionManager({});

chatSessionManager.getAnswer("your-session-id", "What is the capital of France?")
    .then((messages) => {
        console.log(messages);
    })
    .catch((error) => {
        console.error("Error:", error);
    });
```

## How it works

The `ChatSessionManager` class provides a `getAnswer()` method that takes a sessionId, a user prompt, and an optional model name. It first retrieves the chat history from the session storage. If no history is found, it creates a new chat history. It then sends the chat history to the OpenAI API, receives the AI's response, and updates the chat history in the session storage. Finally, it returns the updated chat history.

## Customizing Session Storage

You can create your own session storage implementation by extending the `ChatSession` abstract class and implementing the `putItem`, `getItem`, and `deleteItem` methods. Pass an instance of your custom session storage class to the `ChatSessionManager` constructor.

## License

MIT License. See [LICENSE](./LICENSE) for more information.