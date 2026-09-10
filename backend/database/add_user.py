"""
Create or reset a hospital-staff login account from the command line.
Use this to bootstrap the first real admin, or to reset a locked-out password.

  # create a new user (prompts for the password)
  python -m backend.database.add_user --username j.smith --name "Dr. J. Smith" \
      --role attending_physician --department ICU

  # reset an existing user's password
  python -m backend.database.add_user --username j.smith --reset
"""
import argparse
import getpass
import sys

from backend.core.auth import UserStore


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--username", required=True)
    ap.add_argument("--name", help="full name (create only)")
    ap.add_argument("--role", choices=sorted(UserStore.VALID_ROLES), help="(create only)")
    ap.add_argument("--department", default=None, help="department code, e.g. ICU (create only)")
    ap.add_argument("--hospital", default="H001")
    ap.add_argument("--reset", action="store_true", help="reset the password of an existing user")
    ap.add_argument("--password", help="password (otherwise prompted)")
    a = ap.parse_args()

    store = UserStore()
    pw = a.password or getpass.getpass("New password (min 8 chars): ")

    try:
        if a.reset:
            if not store.find_by_username(a.username):
                print(f"No active user named '{a.username}'.", file=sys.stderr)
                return 1
            store.set_password_by_username(a.username, pw)
            print(f"Password reset for '{a.username}'.")
        else:
            if not (a.name and a.role):
                print("--name and --role are required to create a user.", file=sys.stderr)
                return 2
            created = store.create_user(
                username=a.username, full_name=a.name, role=a.role,
                password=pw, department_code=a.department, hospital_id=a.hospital,
            )
            print(f"Created {created['user_id']}  {created['username']}  ({created['role']}).")
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
