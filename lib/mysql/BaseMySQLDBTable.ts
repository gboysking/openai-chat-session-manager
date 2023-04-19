import mysql, { Connection, ConnectionOptions, ResultSetHeader } from 'mysql2';

export abstract class BaseMySQLDBTable {
    protected tableName: string;
    private config: ConnectionOptions;    
    private state: 'INITIALIZING' | 'INITIALIZED' | "FAIL";
    private onReadyPromises: Array<(value?: unknown) => void>;

    constructor(config: ConnectionOptions, tableName: string) {
        this.config = config;
        this.tableName = tableName;

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

    public queryAsync(query: string, param?: any[]): Promise<any[] | ResultSetHeader> {
        return new Promise(async (resolve, reject) => {
            let connection = await this.getConnection();
            connection.query(query, param, (err, results) => {
                connection.end();

                if (err) {
                    reject(err);
                } else {
                    resolve(results as any[]);
                }
            });
        });
    };

    private async isTableCreated(): Promise<boolean> {
        const results = await this.queryAsync("SHOW TABLES") as any[];

        const tableNames = results.map(row => Object.values(row)[0]);

        return tableNames.includes(this.tableName);
    }

    private async waitUntilTableExists(timeout: number = 6000): Promise<void> {

        const startTime = Date.now();
        const endTime = startTime + timeout;

        while (Date.now() < endTime) {
            try {
                if (await this.isTableCreated()) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        throw new Error(`Timed out waiting for table ${this.tableName} to exist`);
    }

    abstract buildTableSchema(): string;

    public async getConnection(): Promise<Connection> {
        return new Promise((resolve, reject) => {
            const connection = mysql.createConnection(this.config);
            connection.connect((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(connection);
                }
            });
        });
    }

    public createTableIfNotExists(): Promise<void> {
        return new Promise((resolve, reject) => {

            Promise.resolve()
                .then(async () => {
                    const createTableQuery = `
                        CREATE TABLE IF NOT EXISTS ${this.tableName} (
                            ` + this.buildTableSchema() + `
                        );    
                    `;

                    try {
                        let result = await this.queryAsync(createTableQuery) as ResultSetHeader;

                        if (result.warningStatus == 0) {
                            await this.waitUntilTableExists();
                        }
                    } catch (err) {
                        console.error(`Failed to create ${this.tableName} table:`, err);
                        throw err;
                    }

                    resolve();
                })
                .catch((err) => {
                    console.error(`Failed to create ${this.tableName} table:`, err);

                    reject(err);
                });
        });
    }
}