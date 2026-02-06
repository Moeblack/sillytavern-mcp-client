import { Router } from 'express';

/**
 * SillyTavern Server Plugin entry point.
 * Exports: info, init(router), exit()
 */

declare const info: {
    id: string;
    name: string;
    description: string;
};
declare function init(router: Router): Promise<void>;
declare function exit(): Promise<void>;

export { exit, info, init };
