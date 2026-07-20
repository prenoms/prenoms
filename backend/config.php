<?php

/**
 * The one thing that differs between the OVH host and a local `php -S`: where
 * the Session files live. It must be a writable directory **outside the web
 * root** — the files hold people's Verdicts and the family Nom, and nothing
 * stops Apache serving a .json it can see.
 *
 * On OVH free hosting the FTP home is the parent of `www/`, so a sibling of the
 * web root is already unreachable over HTTP. Override with the
 * `PRENOMS_DATA_DIR` environment variable when developing.
 */

declare(strict_types=1);

if (!defined('PRENOMS_DATA_DIR')) {
    define('PRENOMS_DATA_DIR', dirname(__DIR__, 2) . '/prenoms-data');
}
