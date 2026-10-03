# PHub Prototype

PHub is an unfinished, static HTML/CSS/JavaScript prototype for hospital room management.

## Project structure

```text
PHub_Prototype/
|-- index.html
|-- assets/
|   |-- css/
|   |   `-- style.css
|   `-- js/
|       `-- app.js
|-- data/
|   `-- legacy-credentials.txt   # Local-only migration aid; do not deploy
`-- README.md
```

## Run locally

Run a local HTTP server from this folder, then open its URL in a browser. For example, with Python installed:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Using a local server supports browser APIs that may not work when opening `index.html` directly as a file.

## Prototype limitations

- The legacy credentials file is served as a static asset and must not contain real credentials. It exists only to preserve the prototype's old sign-in flow while authentication is being replaced.
- New accounts and the registration invite code are handled in client-side code/browser storage. This is not access control and must not be used for real staff accounts or patient data.
- Before deployment, replace both authentication paths with a server-side identity system, enforce authorization on the server, and remove `data/legacy-credentials.txt`.
- Room, patient, bed-level cleaning, nurse-per-room, and doctor-per-patient assignments persist in this browser's local storage. Discharging a patient or manually setting an available room to Cleaning creates cleaning tasks per affected bed; in Room 104, occupied beds are left alone. If an older saved room is already marked Cleaning but has no cleaning tasks, tasks are created on load. Cleaning tasks must be acknowledged before those beds become available again. Discharging a patient removes that patient's doctor assignments. Older doctor assignments saved on rooms are migrated to the current patients in those rooms at load time. The signed-in session survives refresh and ends when the user logs out. Room 104 has 8 beds; other rooms default to one bed. Bed numbers are shown in Manage Patients and Cleaning Schedule, not Manage Rooms. This is for prototype continuity, not a shared or backed-up database.