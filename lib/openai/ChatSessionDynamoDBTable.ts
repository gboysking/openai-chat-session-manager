import { CreateTableInput } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BaseDynamoDBTable, DynamoDBTableOptions } from "../dynamodb/BaseDynamoDBTable";
import { ChatData, ChatSession } from "./index";

export class ChatSessionDynamoDBTable extends BaseDynamoDBTable implements  ChatSession {
    constructor(options: DynamoDBTableOptions) {
        super(options);
    }

    buildTableSchema(): CreateTableInput {
        return {
            AttributeDefinitions: [
                {
                    AttributeName: 'sessionId',
                    AttributeType: 'S',
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'sessionId',
                    KeyType: 'HASH',
                }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5,
            },
            TableName: this.table
        };
    }

    async putItem(sessionId: string, data: Omit<ChatData, 'sessionId'>): Promise<void> {
        await this.onReady();
        const item: ChatData = {
            sessionId,
            ...data,
        };

        const command = new PutCommand({
            TableName: this.table,
            Item: item,
        });

        await this.client.send(command);
    }

    async getItem(sessionId: string): Promise<ChatData | null> {
        await this.onReady();
        const command = new GetCommand({
            TableName: this.table,
            Key: {
                sessionId: sessionId
            },
        });

        const result = await this.client.send(command);

        return result.Item as ChatData;
    }
    async deleteItem(sessionId: string): Promise<void> {
        await this.onReady();
        const command = new DeleteCommand({
            TableName: this.table,
            Key: {
                sessionId: sessionId
            },
        });

        await this.client.send(command);
    }
}