export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    [key: string]: any;
}

class Logger {
    private level: LogLevel = LogLevel.INFO;

    constructor(level?: LogLevel) {
        if (level) {
            this.level = level;
        }
    }

    setLevel(level: LogLevel) {
        this.level = level;
    }

    private log(level: LogLevel, message: string, context?: Record<string, any>) {
        // Simple level check: DEBUG < INFO < WARN < ERROR
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        if (levels.indexOf(level) < levels.indexOf(this.level)) {
            return;
        }

        const timestamp = new Date().toLocaleString();
        let logLine = `[${timestamp}] [${level}] ${message}`;

        if (context && Object.keys(context).length > 0) {
            logLine += ` ${JSON.stringify(context)}`;
        }

        if (level === LogLevel.ERROR) {
            console.error(logLine);
        } else {
            console.log(logLine);
        }
    }

    debug(message: string, context?: Record<string, any>) {
        this.log(LogLevel.DEBUG, message, context);
    }

    info(message: string, context?: Record<string, any>) {
        this.log(LogLevel.INFO, message, context);
    }

    warn(message: string, context?: Record<string, any>) {
        this.log(LogLevel.WARN, message, context);
    }

    error(message: string, context?: Record<string, any>) {
        this.log(LogLevel.ERROR, message, context);
    }
}

export const logger = new Logger();
