import type { Metadata } from "next";
import { Account } from "../../components/account";

export const metadata: Metadata = {
  title: "Maintainer account",
  robots: { index: false, follow: false },
};
export default function AccountPage() {
  return (
    <div className="prose">
      <h1>Maintainer account</h1>
      <p>
        Link repositories you maintain. Public reports and one-off scans remain available without an
        account.
      </p>
      <Account />
    </div>
  );
}
