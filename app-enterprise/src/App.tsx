import React, { useCallback, useEffect, useState } from "react";
import { LoadingOverlay } from "@deephaven/components"; // Use the loading spinner from the Deephaven components package
import {
  IrisGrid,
  IrisGridModel,
  IrisGridModelFactory,
} from "@deephaven/iris-grid"; // iris-grid is used to display Deephaven tables
import dh from "@deephaven/jsapi-shim"; // Import the shim to use the JS API
import "./App.scss"; // Styles for in this app

const CLIENT_TIMEOUT = 60_000;

const API_URL = process.env.REACT_APP_DEEPHAVEN_API_URL ?? "";

const USER = process.env.REACT_APP_DEEPHAVEN_USER ?? "";

const PASSWORD = process.env.REACT_APP_DEEPHAVEN_PASSWORD ?? "";

/**
 * Wait for Deephaven client to be connected
 * @param client Deephaven client object
 * @returns When the client is connected, rejects on timeout
 */
function clientConnected(client: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.isConnected) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for connect"));
    }, CLIENT_TIMEOUT);

    client.addEventListener(dh.Client.EVENT_CONNECT, () => {
      resolve();
      clearTimeout(timer);
    });
  });
}

/**
 * Load an existing Deephaven table with the client and query name provided
 * Needs to listen for when queries are added to the list as they are not known immediately after connecting.
 * @param client The Deephaven client object
 * @param queryName Name of the query to load
 * @param tableName Name of the table to load
 * @returns Deephaven table
 */
function loadTable(client: any, queryName: string, tableName: string) {
  console.log(`Fetching query ${queryName}, table ${tableName}...`);

  return new Promise((resolve, reject) => {
    let removeListener: () => void;

    const timeout = setTimeout(() => {
      reject(new Error(`Query not found, ${queryName}`));
      removeListener();
    }, 10000);

    function resolveIfQueryFound(queries: any[]) {
      const matchingQuery = queries.find((query) => query.name === queryName);

      if (matchingQuery) {
        resolve(matchingQuery.getTable(tableName));
        clearTimeout(timeout);
        removeListener();
      }
    }

    function listener(event: any) {
      const addedQueries = [event.detail];
      resolveIfQueryFound(addedQueries);
    }

    removeListener = client.addEventListener(
      dh.Client.EVENT_CONFIG_ADDED,
      listener
    );
    const initialQueries = client.getKnownConfigs();
    resolveIfQueryFound(initialQueries);
  });
}

/**
 * Create a new Deephaven table with the session provided.
 * Creates a table that will tick once every second, with two columns:
 * - Timestamp: The timestamp of the tick
 * - A: The row number
 * @param client The Deephaven client object
 * @param name Name of the table to load
 * @returns Deephaven table
 */
async function createTable(client: any) {
  // Create a new session... API is currently undocumented and subject to change in future revisions
  const ide = new dh.Ide(client);

  // Create a default config
  const config = new dh.ConsoleConfig();

  // Set configuration parameters here if you don't want the default
  // config.maxHeapMb = 2048;
  // config.jvmProfile = ...;
  // config.jvmArgs = ...;
  // config.envVars = ...;
  // config.classpath = ...;
  // config.dispatcherHost = ...;
  // config.dispatcherPort = ...;

  console.log("Creating console with config ", config);

  const dhConsole = await ide.createConsole(config);

  console.log("Creating session...");

  // Specify the language, 'python' or 'groovy'
  const session = await dhConsole.startSession("python");

  // Run the code in the session to open a table

  console.log(`Creating table...`);

  // Run the code you want to run. This example just creates a timeTable
  await session.runCode("from deephaven.TableTools import timeTable");
  const result = await session.runCode(
    't = timeTable("00:00:01").update("A=i")'
  );

  // Get the new table definition from the results
  // Results also includes modified/removed objects, which doesn't apply in this case
  const definition = result.changes.created[0];

  console.log(`Fetching table ${definition.name}...`);

  return await session.getObject(definition);
}

/**
 * A functional React component that displays a Deephaven table in an IrisGrid using the @deephaven/iris-grid package.
 * If the query param `tableName` is provided, it will attempt to open and display that table, expecting it to be present on the server.
 * E.g. http://localhost:3000/?tableName=myTable will attempt to open a table `myTable`
 * If no query param is provided, it will attempt to open a new session and create a basic time table and display that.
 * By default, tries to connect to the server defined in the REACT_APP_CORE_API_URL variable, which is set to http://localhost:1000/jsapi
 * See create-react-app docs for how to update these env vars: https://create-react-app.dev/docs/adding-custom-environment-variables/
 */
function App() {
  const [model, setModel] = useState<IrisGridModel>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [client, setClient] = useState<any>();

  const initApp = useCallback(async () => {
    try {
      // Connect to the Web API server
      const baseUrl = new URL(API_URL ?? "", `${window.location}`);

      const websocketUrl = new URL("/socket", baseUrl);
      if (websocketUrl.protocol === "http:") {
        websocketUrl.protocol = "ws:";
      } else {
        websocketUrl.protocol = "wss:";
      }

      console.log(`Creating client ${websocketUrl}...`);

      const client = new dh.Client(websocketUrl.href);

      setClient(client);

      await clientConnected(client);

      await client.login({ username: USER, token: PASSWORD, type: "password" });

      // Get the table name from the search params `queryName` and `tableName`.
      const searchParams = new URLSearchParams(window.location.search);
      const queryName = searchParams.get("queryName");
      const tableName = searchParams.get("tableName");

      // If a table name was specified, load that table. Otherwise, create a new table.
      const table = await (queryName && tableName
        ? loadTable(client, queryName, tableName)
        : createTable(client));

      // Create the `IrisGridModel` for use with the `IrisGrid` component
      console.log(`Creating model...`);

      const newModel = await IrisGridModelFactory.makeModel(table);

      setModel(newModel);

      console.log("Table successfully loaded!");
    } catch (e) {
      console.error("Unable to load table", e);
      setError(`${e}`);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    initApp();
  }, [initApp]);

  useEffect(() => {
    return () => {
      // On unmount, disconnect the client we created (which cleans up the session)
      client?.disconnect();
    };
  }, [client]);

  const isLoaded = model != null;

  return (
    <div className="App">
      {isLoaded && <IrisGrid model={model} />}
      {!isLoaded && (
        <LoadingOverlay
          isLoaded={isLoaded}
          isLoading={isLoading}
          errorMessage={error ? error : null}
        />
      )}
    </div>
  );
}

export default App;
