/**
 * Glossary: one-line definitions for first-use terms (`**Term**` in narration). Simple Technical
 * English. Keys are lower-case; lookups are case-insensitive and ignore trailing "s".
 */
export interface GlossaryEntry {
  term: string
  definition: string
  /** Optional in-app link to the topic that teaches it. */
  href?: string
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'CRDT',
    definition:
      'A data type that many copies can change at the same time and still end up equal after they merge.',
    href: '/crdts/the-problem/meet-crdts',
  },
  { term: 'replica', definition: 'One copy of the data on one device or server.' },
  {
    term: 'merge',
    definition: 'Combine two copies into one, using a fixed rule, so every copy agrees.',
  },
  {
    term: 'eventual consistency',
    definition:
      'Copies may differ for a while, but once they have exchanged changes they are equal.',
  },
  {
    term: 'concurrent',
    definition: 'Two changes made without either side knowing about the other.',
  },
  {
    term: 'lock',
    definition: 'A rule that lets only one writer change a value at a time.',
    href: '/crdts/the-problem/locks-the-classic-answer',
  },
  {
    term: 'transaction',
    definition: 'A group of changes that all happen together, or not at all.',
  },
  {
    term: 'cache',
    definition: 'A copy of data kept close to the reader so reads are fast.',
  },
  {
    term: 'coordinator',
    definition:
      'The one place every writer must talk to before it may write, such as a lock server or a primary database.',
  },
  { term: 'round trip', definition: 'One message out and its answer back.' },
  {
    term: 'lease',
    definition: 'A lock that expires after a set time unless the holder renews it.',
  },
  {
    term: 'race',
    definition: 'Two writes made at the same time, so the result depends on which one lands last.',
  },
  {
    term: 'state-based',
    definition: 'A CRDT style where replicas send their whole state and merge it.',
    href: '/crdts/state-based/the-shape-of-a-state-crdt',
  },
  {
    term: 'operation-based',
    definition: 'A CRDT style where replicas send the operations they did and apply them.',
    href: '/crdts/operation-based/ops-instead-of-state',
  },
  { term: 'commutative', definition: 'Order does not matter: merge(a, b) equals merge(b, a).' },
  {
    term: 'associative',
    definition: 'Grouping does not matter: merge(merge(a, b), c) equals merge(a, merge(b, c)).',
  },
  { term: 'idempotent', definition: 'Doing it twice changes nothing: merge(a, a) equals a.' },
  {
    term: 'state',
    definition: 'Everything one copy holds: the value plus its sidecar (timestamps, ids, tags).',
    href: '/crdts/state-based/the-shape-of-a-state-crdt',
  },
  {
    term: 'max register',
    definition: 'The smallest state CRDT: one number; a merge keeps the bigger of the two.',
    href: '/crdts/state-based/the-shape-of-a-state-crdt',
  },
  {
    term: 'LWW register',
    definition: 'Last-Writer-Wins: one value with a timestamp; on merge the newer timestamp wins.',
    href: '/crdts/state-based/lww-register',
  },
  {
    term: 'LWW map',
    definition: 'A record where each field is its own LWW register; fields merge one by one.',
    href: '/crdts/state-based/lww-map',
  },
  {
    term: 'sidecar',
    definition:
      'Extra data stored next to a value (timestamps, node ids, tags) so merges can decide.',
  },
  {
    term: 'timestamp',
    definition:
      'A number that says when a write happened. It can be a clock time or a logical counter.',
  },
  { term: 'node id', definition: 'A name that tells replicas apart, like alice or server-2.' },
  { term: 'node', definition: 'One copy that can write. Each node has its own id.' },
  {
    term: 'tombstone',
    definition: 'A marker that says "this item was deleted" so the delete survives a merge.',
    href: '/crdts/operation-based/tombstones-and-garbage',
  },
  {
    term: 'G-Counter',
    definition:
      'A counter that only goes up: each node counts its own increments; merge takes the max per node.',
    href: '/crdts/state-based/g-counter',
  },
  {
    term: 'PN-Counter',
    definition: 'Two G-Counters, one for increments and one for decrements.',
    href: '/crdts/state-based/pn-counter',
  },
  {
    term: 'G-Set',
    definition: 'A set you can only add to; merge is the union.',
    href: '/crdts/state-based/g-set',
  },
  {
    term: '2P-Set',
    definition: 'An add set plus a removed set; once removed, an item cannot come back.',
    href: '/crdts/state-based/two-phase-set',
  },
  {
    term: 'OR-Set',
    definition:
      'Observed-Remove set: each add gets a unique tag; a remove only kills the tags it has seen.',
    href: '/crdts/state-based/or-set',
  },
  { term: 'tag', definition: 'A unique id given to one add, like alice:3.' },
  {
    term: 'union',
    definition: 'Everything that is in either set. Merging two G-Sets is a union.',
  },
  {
    term: 'LWW-Element-Set',
    definition:
      'A set where each element keeps its newest add stamp and its newest remove stamp; the newer one decides.',
    href: '/crdts/state-based/lww-element-set',
  },
  {
    term: 'bias',
    definition:
      'The tie rule of an LWW-Element-Set: when the add and remove stamps are equal, add-wins keeps the element and remove-wins drops it.',
  },
  {
    term: 'RGA',
    definition:
      'Replicated Growable Array: a list where each item has an id and says which item it comes after.',
    href: '/crdts/operation-based/sequences-rga',
  },
  {
    term: 'causal order',
    definition: 'An operation is applied only after every operation it depends on.',
  },
  {
    term: 'Lamport clock',
    definition: 'A counter that goes up on every event and jumps past any bigger counter it sees.',
    href: '/crdts/vector-clocks/lamport-clocks',
  },
  {
    term: 'vector clock',
    definition:
      'One counter per node. Comparing two vectors tells you before, after, or concurrent.',
    href: '/crdts/vector-clocks/vector-clocks',
  },
  {
    term: 'hybrid logical clock',
    definition:
      'Wall-clock time plus a counter, so stamps stay close to real time and never go backwards.',
    href: '/crdts/vector-clocks/hybrid-logical-clocks',
  },
  { term: 'clock skew', definition: 'Two machines whose clocks disagree.' },
  {
    term: 'sibling',
    definition: 'One of several concurrent versions a store keeps until someone resolves them.',
  },
  { term: 'delta', definition: 'Only the part of the state that changed since the last send.' },
  {
    term: 'UUID',
    definition: 'A 128-bit id that is unique without a central server.',
    href: '/uuids/anatomy/uuid-v4',
  },
  // ─── regex ───
  {
    term: 'choice point',
    definition:
      'A saved place the regex engine can come back to when a later test fails: which token, where in the text, how much it took.',
  },
  {
    term: 'backtracking',
    definition: 'Going back to the last choice point and trying the next option when a test fails.',
    href: '/regex/matching/backtracking',
  },
  {
    term: 'greedy',
    definition:
      'A quantifier that takes as many characters as it can, then gives them back one at a time if a later test fails.',
  },
  {
    term: 'lazy',
    definition:
      'A quantifier that takes as few characters as it can, then takes one more each time a later test fails.',
  },
  {
    term: 'capture group',
    definition:
      'Parentheses in a pattern; the text they matched is handed back as $1, $2 and so on.',
  },
  {
    term: 'quantifier',
    definition:
      'A mark after a test that says how many times it may run: ? (0 or 1), * (0 or more), + (1 or more), {m,n}.',
  },
  // ─── columnar stores ───
  {
    term: 'row store',
    definition: 'A layout that keeps all the values of one row together on disk.',
    href: '/columnar-stores/layout/rows-vs-columns',
  },
  {
    term: 'column store',
    definition: 'A layout that keeps all the values of one column together on disk.',
    href: '/columnar-stores/layout/rows-vs-columns',
  },
  {
    term: 'partition key',
    definition: 'The part of a primary key that is hashed to choose which node stores the row.',
    href: '/columnar-stores/layout/partition-and-clustering',
  },
  {
    term: 'clustering key',
    definition: 'The part of a primary key that sets the order of rows inside one partition.',
    href: '/columnar-stores/layout/partition-and-clustering',
  },
  {
    term: 'partition',
    definition:
      'All the rows that share one partition key; they live together on one node (and its replicas).',
  },
  {
    term: 'hot partition',
    definition:
      'A partition that gets far more traffic than the others, so one node does most of the work.',
  },
]

const index = new Map(GLOSSARY.map((e) => [normalize(e.term), e]))

function normalize(term: string): string {
  const t = term.trim().toLowerCase()
  return t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t
}

export function lookupTerm(term: string): GlossaryEntry | undefined {
  return index.get(normalize(term)) ?? index.get(term.trim().toLowerCase())
}
