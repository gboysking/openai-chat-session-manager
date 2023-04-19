import { ConnectionOptions, ResultSetHeader } from "mysql2";
import { BaseMySQLDBTable } from "../mysql";
import { ChatData, ChatSession } from "./index";

export class ChatSessionMySQLDBTable extends BaseMySQLDBTable implements ChatSession {
    constructor(config: ConnectionOptions, tableName: string) {
        super(config, tableName);
    }

    buildTableSchema(): string {
        const createTableQuery = " \
            `sessionId` varchar(255) NOT NULL PRIMARY KEY, \
            `created` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
            `lastUpdate` TIMESTAMP DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, \
            `totalTokens` int(11) NOT NULL DEFAULT 0, \
            `messages` JSON NOT NULL \
        ";
        return createTableQuery;
    }

    async putItem(sessionId: string, data: Omit<ChatData, 'sessionId'>): Promise<void> {

        await this.onReady();

        const query = `
                    INSERT INTO ${this.tableName} (sessionId, messages, totalTokens)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE messages = ?, totalTokens = ?;
                    `;


        const messages = JSON.stringify(data.messages);

        await this.queryAsync(query, [sessionId, messages, data.totalTokens, messages, data.totalTokens]);
    }

    async getItem(sessionId: string): Promise<ChatData | null> {
        await this.onReady();

        const query = `SELECT * FROM ${this.tableName} WHERE sessionId = ?`;

        let result = await this.queryAsync(query, [sessionId]) as any[];

        return result.length == 0 ? null : result[0] as ChatData;
    }
    async deleteItem(sessionId: string): Promise<void> {
        await this.onReady();

        const query = `DELETE FROM ${this.tableName} WHERE WHERE sessionId = ?`;

        let result = await this.queryAsync(query, [sessionId]) as ResultSetHeader;
    }
}