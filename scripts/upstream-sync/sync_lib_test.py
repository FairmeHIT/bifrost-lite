import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
import sync_lib


class DenylistMatchingTest(unittest.TestCase):
    def test_directory_entries_match_the_directory_and_children_only(self):
        denylist = ["plugins/routing", "ui/app/workspace/governance/users", "transports/bifrost-http/handlers/mcp*"]

        self.assertTrue(sync_lib.is_skipped("plugins/routing", denylist))
        self.assertTrue(sync_lib.is_skipped("plugins/routing/go.mod", denylist))
        self.assertTrue(sync_lib.is_skipped("ui/app/workspace/governance/users/page.tsx", denylist))
        self.assertTrue(sync_lib.is_skipped("transports/bifrost-http/handlers/mcp.go", denylist))
        self.assertTrue(sync_lib.is_skipped("transports/bifrost-http/handlers/mcpoauth2_test.go", denylist))

        self.assertFalse(sync_lib.is_skipped("plugins/routing-extra/go.mod", denylist))
        self.assertFalse(sync_lib.is_skipped("ui/app/workspace/governance/users2/page.tsx", denylist))

    def test_lite_removed_enterprise_fallback_pages_are_denylisted(self):
        denylist = sync_lib.read_denylist()

        removed_fallback_pages = [
            "ui/app/_fallbacks/enterprise/components/rbac/rbacView.tsx",
            "ui/app/_fallbacks/enterprise/components/user-groups/usersView.tsx",
            "ui/app/_fallbacks/enterprise/components/user-groups/businessUnitsView.tsx",
            "ui/app/_fallbacks/enterprise/components/scim/scimView.tsx",
            "ui/app/_fallbacks/enterprise/components/scim/wizard/discoverCallbackView.tsx",
            "ui/app/_fallbacks/enterprise/components/audit-logs/auditLogsView.tsx",
            "ui/app/_fallbacks/enterprise/components/access-profiles/accessProfilesIndexView.tsx",
        ]

        for page in removed_fallback_pages:
            self.assertTrue(sync_lib.is_skipped(page, denylist), page)


if __name__ == "__main__":
    unittest.main()
