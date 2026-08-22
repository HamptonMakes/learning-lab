/**
 * The navigable catalog (Module › Unit › Topic). Ids are URL segments and are stable forever.
 * Topic bodies live next to this file under src/content/<module>/… and are loaded lazily.
 */
import type { ModuleMeta } from '@/lesson/catalog'

export const crdts: ModuleMeta = {
  id: 'crdts',
  title: 'Distributed Data Types (CRDTs)',
  short: 'CRDTs',
  summary:
    'How many copies of the same data can change at the same time and still agree in the end — and how to pick the right type for your data.',
  status: 'live',
  units: [
    {
      id: 'the-problem',
      numeral: 'I',
      title: 'The Problem',
      summary: 'Why copies of data disagree, what locks cost, and where CRDTs fit.',
      topics: [
        {
          id: 'more-than-one-copy',
          title: 'More than one copy',
          summary: 'Two devices edit the same thing at the same time. Whoops.',
        },
        {
          id: 'locks-the-classic-answer',
          title: 'Locks: the classic answer',
          summary: 'A lock lets one writer go at a time.',
        },
        {
          id: 'locks-need-a-connection',
          title: 'Locks need a connection',
          summary: 'Offline devices cannot take a lock.',
        },
        {
          id: 'not-everything-needs-a-transaction',
          title: 'Not everything needs a transaction',
          summary: 'Some data must be exact; a lot of data only needs to agree eventually.',
        },
        {
          id: 'meet-crdts',
          title: 'Meet CRDTs',
          summary: 'Rules set up front, merge in any order, every copy ends the same.',
        },
        {
          id: 'where-they-are-used',
          title: 'Where they are used',
          summary: 'Docs, design tools, notes, databases — and more than you think.',
        },
      ],
    },
    {
      id: 'state-based',
      numeral: 'II',
      title: 'State-based CRDTs',
      summary: 'Send your whole state; merge with a rule that always agrees.',
      topics: [
        {
          id: 'the-shape-of-a-state-crdt',
          title: 'The shape of a state CRDT',
          summary: 'State plus a merge that is commutative, associative, and idempotent.',
        },
        {
          id: 'lww-register',
          title: 'LWW Register',
          summary: 'One value, one timestamp. Newest wins.',
        },
        {
          id: 'lww-map',
          title: 'LWW Map',
          summary: 'A document where each field merges on its own.',
        },
        {
          id: 'g-counter',
          title: 'G-Counter',
          summary: 'Each node counts its own; merge takes the max.',
        },
        {
          id: 'pn-counter',
          title: 'PN-Counter',
          summary: 'Two G-Counters: one for up, one for down.',
        },
        { id: 'g-set', title: 'G-Set', summary: 'A set you can only add to; merge is union.' },
        {
          id: 'two-phase-set',
          title: '2P-Set',
          summary: 'Add set plus a removed set. Gone is gone.',
        },
        {
          id: 'lww-element-set',
          title: 'LWW-Element-Set',
          summary: 'Timestamps per element. Add-wins or remove-wins.',
        },
        { id: 'or-set', title: 'OR-Set', summary: 'Unique tags make re-adding work.' },
        {
          id: 'in-context-shopping-list',
          title: 'In context: a shared shopping list',
          summary: 'Compose LWW fields, an OR-Set, and PN-Counters.',
        },
        {
          id: 'the-cost-of-state',
          title: 'The cost of state',
          summary: 'Sending everything adds up. Deltas help.',
        },
      ],
    },
    {
      id: 'operation-based',
      numeral: 'III',
      title: 'Operation-based CRDTs',
      summary: 'Send what you did, not what you have.',
      topics: [
        {
          id: 'ops-instead-of-state',
          title: 'Ops instead of state',
          summary: 'Ship operations; they must arrive once and in causal order.',
        },
        {
          id: 'every-device-needs-a-name',
          title: 'Every device needs a name',
          summary: 'Node ids and op ids. Hello, UUIDs.',
        },
        {
          id: 'op-counter',
          title: 'Op-based counter',
          summary: 'Increments commute, so order does not matter.',
        },
        {
          id: 'op-or-set',
          title: 'Op-based OR-Set',
          summary: 'Add with a tag; remove the tags you have seen.',
        },
        {
          id: 'sequences-rga',
          title: 'Sequences (RGA)',
          summary: 'Insert after an id. Tombstones keep the order stable.',
        },
        {
          id: 'in-context-collab-text',
          title: 'In context: typing together',
          summary: 'Two people type in one text at once.',
        },
        {
          id: 'tombstones-and-garbage',
          title: 'Tombstones and garbage',
          summary: 'Deletes leave markers. Eventually you clean up.',
        },
      ],
    },
    {
      id: 'vector-clocks',
      numeral: 'IV',
      title: 'Vector Clocks & Causality',
      summary: 'How to know what happened before what — without trusting wall clocks.',
      topics: [
        {
          id: 'wall-clocks-lie',
          title: 'Wall clocks lie',
          summary: 'Clock skew makes "newest" wrong.',
        },
        {
          id: 'lamport-clocks',
          title: 'Lamport clocks',
          summary: 'A counter that only moves forward.',
        },
        {
          id: 'vector-clocks',
          title: 'Vector clocks',
          summary: 'One counter per node tells you before, after, or concurrent.',
        },
        {
          id: 'detecting-conflicts',
          title: 'Detecting conflicts',
          summary: 'Concurrent versions become siblings. Someone must choose.',
        },
        {
          id: 'hybrid-logical-clocks',
          title: 'Hybrid logical clocks',
          summary: 'Wall time plus a counter. Best of both.',
        },
        {
          id: 'in-context-notes-sync',
          title: 'In context: a notes app',
          summary: 'Vector clocks decide what to merge.',
        },
      ],
    },
    {
      id: 'choosing',
      numeral: 'V',
      title: 'Choosing & Using CRDTs',
      summary: 'Pick the right type for your data, and know the trade-offs.',
      topics: [
        {
          id: 'which-crdt-for-which-data',
          title: 'Which CRDT for which data',
          summary: 'Register, counter, set, map, or list?',
        },
        {
          id: 'composing-a-document',
          title: 'Composing a document',
          summary: 'Build a schema from CRDT parts.',
        },
        {
          id: 'tradeoffs',
          title: 'Trade-offs',
          summary: 'State vs ops, metadata growth, tombstones.',
        },
        {
          id: 'real-systems',
          title: 'Real systems',
          summary: 'What Automerge, Yjs, Riak, Redis, Figma, and Apple Notes use.',
        },
        { id: 'course-complete', title: 'Course complete', summary: 'Your checklist.' },
      ],
    },
  ],
}

export const uuids: ModuleMeta = {
  id: 'uuids',
  title: 'UUIDs (v4, v7)',
  short: 'UUIDs',
  summary: 'What is inside a UUID, why v4 is random, and why v7 sorts by time.',
  status: 'prototype',
  units: [
    {
      id: 'anatomy',
      numeral: 'I',
      title: 'Anatomy of a UUID',
      topics: [
        {
          id: 'uuid-v4',
          title: 'UUID v4',
          summary: '122 random bits with a version and a variant.',
        },
        { id: 'uuid-v7', title: 'UUID v7', summary: 'A timestamp first, so ids sort by time.' },
      ],
    },
  ],
}

export const regex: ModuleMeta = {
  id: 'regex',
  title: 'Regular Expressions',
  short: 'Regex',
  summary: 'Watch a pattern match a string one step at a time — including when it backtracks.',
  status: 'prototype',
  units: [
    {
      id: 'matching',
      numeral: 'I',
      title: 'How matching works',
      topics: [
        {
          id: 'step-by-step-matching',
          title: 'Step-by-step matching',
          summary: 'A cursor, a pattern, and a decision at each character.',
        },
        {
          id: 'backtracking',
          title: 'Backtracking',
          summary: 'When greedy goes too far, the engine steps back.',
        },
      ],
    },
  ],
}

export const columnar: ModuleMeta = {
  id: 'columnar-stores',
  title: 'Columnar Data Stores',
  short: 'Columnar',
  summary: 'Why storing columns instead of rows changes which queries are fast.',
  status: 'prototype',
  units: [
    {
      id: 'layout',
      numeral: 'I',
      title: 'Rows vs columns',
      topics: [
        {
          id: 'rows-vs-columns',
          title: 'Rows vs columns',
          summary: 'The same table, two layouts on disk.',
        },
        {
          id: 'partition-and-clustering',
          title: 'Partition and clustering keys',
          summary: 'Where a row lives and how it is sorted.',
        },
      ],
    },
  ],
}

export const modules: ModuleMeta[] = [crdts, uuids, regex, columnar]

export function findModule(id: string): ModuleMeta | undefined {
  return modules.find((m) => m.id === id)
}
