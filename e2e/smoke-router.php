<?php

/**
 * Emulates `root.htaccess` for PHP's built-in server, so the staged tree can
 * be exercised the way Apache will serve it. Used only by `just e2e` —
 * it is never uploaded, and `tools/stage.sh` does not copy it.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// RewriteRule ^api(/.*)?$ server/index.php
if (preg_match('#^/api(/.*)?$#', $path) === 1) {
    require __DIR__ . '/server/index.php';
    return true;
}

// RewriteCond %{REQUEST_FILENAME} !-f — a real file is served as itself.
if ($path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

// Everything else is the app: /s/K7M2QX9RTB must reach the shell.
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
return true;
