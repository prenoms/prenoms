<?php

/**
 * The whole test framework. The host allows no Composer, so tests are plain
 * PHP scripts run by the CLI binary and judged by their exit code.
 */

declare(strict_types=1);

$GLOBALS['tests_run'] = 0;
$GLOBALS['tests_failed'] = 0;
$GLOBALS['current_test'] = '';

function test(string $name, callable $body): void
{
    $GLOBALS['tests_run']++;
    $GLOBALS['current_test'] = $name;
    try {
        $body();
        fwrite(STDOUT, "  ok   $name\n");
    } catch (Throwable $e) {
        $GLOBALS['tests_failed']++;
        fwrite(STDOUT, "  FAIL $name\n       " . $e->getMessage() . "\n");
    }
}

function assert_true(bool $condition, string $message = 'expected true'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assert_equals(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(
            ($message === '' ? '' : "$message: ")
            . 'expected ' . json_encode($expected) . ', got ' . json_encode($actual)
        );
    }
}

/** Floats compared with a tolerance, since Ratings are never integers for long. */
function assert_close(float $expected, float $actual, float $epsilon = 1e-9): void
{
    if (abs($expected - $actual) > $epsilon) {
        throw new RuntimeException("expected $expected, got $actual");
    }
}

function summary(): void
{
    $run = $GLOBALS['tests_run'];
    $failed = $GLOBALS['tests_failed'];
    fwrite(STDOUT, "\n$run tests, $failed failed\n");
    exit($failed === 0 ? 0 : 1);
}
