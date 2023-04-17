import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { CreateTableCommand, DescribeTableCommand, DescribeTableCommandInput, DynamoDBClient, TableStatus, CreateTableInput } from "@aws-sdk/client-dynamodb";


export interface DynamoDBTableOptions {
    table: string;
    client?: DynamoDBDocument;
}

export abstract class BaseDynamoDBTable {
    protected client: DynamoDBDocument;
    protected table: string;
    protected state: 'INITIALIZING' | 'INITIALIZED' | "FAIL";
    private onReadyPromises: Array<(value?: unknown) => void>;

    constructor(options: DynamoDBTableOptions) {
        if (options.client) {
            this.client = DynamoDBDocument.from(options.client);
        } else {
            this.client = DynamoDBDocument.from(new DynamoDBClient({}));
        }

        this.table = options.table;

        this.state = 'INITIALIZING';
        this.onReadyPromises = [];

        Promise.resolve()
            .then(() => {
                return this.createTableIfNotExists();
            })
            .then(() => {
                this.state = 'INITIALIZED';
                this.resolveReadyPromises();
            })
            .catch((error) => {
                this.state = "FAIL";
                this.rejectReadyPromises(error);
            });
    }

    onReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === 'INITIALIZED') {
                resolve();
            } else if (this.state === 'FAIL') {
                reject();
            } else {
                this.onReadyPromises.push((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });                
            }
        });
    }

    private resolveReadyPromises(): void {
        for (const resolve of this.onReadyPromises) {
            resolve();
        }
        this.onReadyPromises = [];
    }

    private rejectReadyPromises(error: any): void {
        for (const resolve of this.onReadyPromises) {
            resolve(error);
        }
        this.onReadyPromises = [];
    }

    // Wait until the table exists
    async waitUntilTableExists(timeout: number = 6000): Promise<void> {
        const command: DescribeTableCommandInput = { TableName: this.table };
        const startTime = Date.now();
        const endTime = startTime + timeout;

        while (Date.now() < endTime) {
            try {
                let result = await this.client.send(new DescribeTableCommand(command));

                if (result.Table.TableStatus == TableStatus.ACTIVE) {
                    return;
                } else if (result.Table.TableStatus == TableStatus.DELETING || result.Table.TableStatus == TableStatus.INACCESSIBLE_ENCRYPTION_CREDENTIALS) {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        throw new Error(`Timed out waiting for table ${this.table} to exist`);
    }

    abstract buildTableSchema() : CreateTableInput;
    

    async createTableIfNotExists(): Promise<void> {
        try {
            await this.client.send(new DescribeTableCommand({ TableName: this.table }));
        } catch (error: any) {
            if (error.name === "ResourceNotFoundException") {
                let params = this.buildTableSchema();
                params.TableName =this.table;

                await this.client.send(new CreateTableCommand(params));

                // Wait until table is active
                await this.waitUntilTableExists();
            } else {
                console.error(
                    "Error checking for the existence of the DynamoDB table:",
                    error
                );
                throw error;
            }
        }
    }   
}
