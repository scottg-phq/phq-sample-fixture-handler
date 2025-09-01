# PlayHQ Fixture Handler - Interview Challenge

A simplified mock implementation of PlayHQ's fixture upload system for interview purposes.

## System Overview

Processes CSV files containing sports fixture data, validates content, and persists to Neo4j database.

## Files

- **`interview-simplified-fixture-handler.ts`** - Main orchestrator handling S3 operations, validation, and persistence
- **`interview-validation-service.ts`** - File format and business rule validation 
- **`interview-repository-layer.ts`** - Neo4j database operations and queries
- **`sample_fixture/`** - Sample CSV with 48 rows of fixture data

## Current System

- **Current limit**: 2000 CSV rows maximum
- **Sample data**: 2 grades, 4 teams each, 12 rounds, 2 games per round
- **Architecture**: S3 → Validation → Neo4j → Events

## Enhancement Request

**The system currently supports a maximum of 2000 CSV rows. There is a feature request to increase this limit to 5000 or 10000 rows.**

**Your task: What changes would you make to achieve this outcome?**

Consider all aspects of the system that would be impacted by this change and propose your solution.
