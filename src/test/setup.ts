// jsdom does not implement IndexedDB. This installs an in-memory implementation
// (indexedDB, IDBKeyRange, ...) as globals for the test run.
import 'fake-indexeddb/auto';
