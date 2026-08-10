# Introspecting our Looker instance

- `looker-cli --token-file` may be available in our dev environment to interact with the current Looker instance being used

# Script Design Guidelines

## 1. Outline-like Main Function
- Write the top-level main function as a high-level sequential outline of the execution phases
- It should consist only of function calls, variable assignments, simple control flow (conditionals, loops), and helper function calls
- Avoid inline logging, data parsing, or configuration key mapping inside the main function
- Did I mention NO LOGGING in the main function?

## 2. Hoisted Pure Helpers
- Define all implementation details in helper functions placed below the main flow
- Name functions to be clear and self-explanatory in the context of the main function
- Write helper functions as pure functions (always pass their inputs explicitly as arguments, do not access outer scopes or closures)

## 3. Open Source Hygiene
- Avoid corporate-specific, internal, or proprietary terminology, tool names, or network proxy references (e.g. internal proxies, helper binaries, or internal package managers).
- Keep all log statements, comments, and troubleshooting diagnostics completely generic and standards-compliant.

# React Coding Guidelines

- React components should have three sections: hook declarations (with no function implementations), returned component JSX, hoisted function implementations.

Example (in JS, but applies to TS too):

```
function UserProfile({ userId }) {
	const [user, setUser] = useState(null)
	const [status, setStatus] = useState('idle')

	useEffect(handleUserReset, [userId])
	useAsyncEffect(fetchUserProfile, [userId])

	return (
		<div className="profile-card">
			{status === 'loading' && <p>Loading...</p>}
			{status === 'success' && user && (
				<div>
					<h2>{user.name}</h2>
					<button onClick={handleRefreshClick}>Refresh</button>
				</div>
			)}
		</div>
	    )

	function handleUserReset() {
		setUser(null)
		setStatus('idle')
	    }
	async function fetchUserProfile() {
		setStatus('loading')
		const response = await fetch(`/api/users/${userId}`)
		const data = await response.json()
		setUser(data)
		setStatus('success')
	    }
	function handleRefreshClick() {
		fetchUserProfile()
	    }
}
```
