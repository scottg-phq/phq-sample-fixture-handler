# PlayHQ Fixture Handler - Interview Challenge

A simplified mock implementation of PlayHQ's fixture upload system for interview purposes.

This code is *not designed to be executed*, it is a mock implementation of the fixture upload system for interview purposes.

## System Overview

Processes CSV files containing sports fixture data, validates content, and persists to Postgres database.

## Files

- **`fixture-handler.ts`** - Main handler with validation, processing, and event generation
- **`repository.ts`** - Postgres database operations and queries
- **`types.ts`** - Shared type definitions
- **`sample_fixture/`** - Sample CSV with 48 rows of fixture data

## Current System

- **Current limit**: 2000 CSV rows maximum
- **Sample data**: 2 grades, 4 teams each, 12 rounds, 2 games per round
- **Architecture**: S3 → Validation → Postgres → Events

## Enhancement Request

**The system currently supports a maximum of 2000 CSV rows. There is a feature request to increase this limit to 5000 or 10000 rows.**

**Your task: What changes would you make to achieve this outcome?**

Consider all aspects of the system that would be impacted by this change and propose your solution.
