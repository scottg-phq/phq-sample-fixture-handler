/**
 * SHARED TYPES - INTERVIEW VERSION
 * 
 * Centralized type definitions used across the fixture upload system
 */

// CORE DOMAIN TYPES
export interface FixtureUploadCommand {
  seasonID: string
  objectKey: string
}

export interface BulkFixtureUpload {
  errors: string[] | null
  fixture: any
}

export interface ResultMap<T> {
  [key: string]: T
}

export interface RoundParam {
  round: { sequenceNo: number; provisionalDate: string }
  games: any[]
}

// DATABASE ENTITY TYPES
export interface GameNode {
  id: string
  gradeID: string
  homeTeamID: string
  awayTeamID: string
  date: string
  provisionalDates: string[]
}

export interface Round {
  id: string
  gradeID: string
  sequenceNo: number
  provisionalDate: string
}

export interface Competition {
  id: string
  seasonID: string
  type: 'DOMESTIC' | 'TOURNAMENT'
}

export interface Grade {
  id: string
  code: string
  seasonID: string
  noOfRounds: number
}

export interface Team {
  id: string
  name: string
  gradeID: string
}

// VALIDATION TYPES
export interface ValidationError {
  type: 'FILE_FORMAT' | 'BUSINESS_RULE' | 'DATA_INTEGRITY'
  message: string
  row?: number
  column?: string
  gradeID?: string
}

export interface FixtureRow {
  gradeCode: string
  homeTeam: string
  awayTeam: string
  date: string
  round: number
  gameType?: string
}

export interface ValidationContext {
  seasonID: string
  grades: Grade[]
  teams: Team[]
  existingFixtures: { [gradeID: string]: boolean }
}
