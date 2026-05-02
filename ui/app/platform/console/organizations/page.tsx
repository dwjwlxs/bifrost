/**
 * Organizations Page
 * Route: /platform/console/organizations
 * Lists the user's organizations (from JWT claims) and provides links to detail pages.
 * Accessible to all authenticated users.
 */
import { Link } from "@tanstack/react-router";
import { usePlatformListOrgsQuery, usePlatformListTeamsQuery } from "@/lib/platform/platformApi";
import { useUserRole } from "@/lib/platform/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, UsersRound, ChevronRight, ShieldCheck } from "lucide-react";

export default function OrganizationsPage() {
	const { data: orgs, isLoading: orgsLoading } = usePlatformListOrgsQuery();
	const { data: teams, isLoading: teamsLoading } = usePlatformListTeamsQuery();
	const { isAdmin, isOwner, isTeamAdmin } = useUserRole();
	const isPrivileged = isAdmin || isOwner || isTeamAdmin;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
				<p className="text-muted-foreground">Organizations and teams you belong to.</p>
			</div>

			{/* Organizations Grid */}
			<div>
				<h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
					<Building2 className="h-5 w-5" />
					Organizations
				</h2>

				{orgsLoading ? (
					<div className="flex items-center justify-center py-12">
						<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
					</div>
				) : !orgs || orgs.length === 0 ? (
					<div className="rounded-lg border border-dashed py-12 text-center">
						<p className="text-muted-foreground text-sm">You don&apos;t belong to any organizations.</p>
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{orgs.map((org) => {
							const isOrgAdmin = isOwner; // current user is org admin of their own orgs
							return (
								<Card key={org.id} className="group hover:border-primary/50 relative overflow-hidden transition-colors">
									<CardHeader className="pb-3">
										<div className="flex items-start justify-between">
											<div className="flex items-center gap-2">
												<div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-md">
													<Building2 className="text-primary h-4 w-4" />
												</div>
												<div>
													<CardTitle className="text-base">{org.name}</CardTitle>
													<CardDescription className="font-mono text-xs">{org.id}</CardDescription>
												</div>
											</div>
											{isOrgAdmin && (
												<Badge variant="default" className="text-xs">
													<ShieldCheck className="mr-1 h-3 w-3" />
													Admin
												</Badge>
											)}
										</div>
									</CardHeader>
									<CardContent>
										<div className="text-muted-foreground mb-4 text-xs">
											{org.owner_user_id && <span>Owner ID: {org.owner_user_id}</span>}
										</div>
										<Button variant="outline" size="sm" className="group-hover:border-primary w-full" asChild>
											<Link to="/platform/console/organizations/$orgId" params={{ orgId: org.id }}>
												View Details
												<ChevronRight className="ml-1 h-4 w-4" />
											</Link>
										</Button>
									</CardContent>
								</Card>
							);
						})}
					</div>
				)}
			</div>

			{/* Teams Section — only visible to privileged users */}
			{isPrivileged && (
				<div>
					<h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
						<UsersRound className="h-5 w-5" />
						My Teams
					</h2>

					{teamsLoading ? (
						<div className="flex items-center justify-center py-8">
							<div className="border-primary h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : !teams || teams.length === 0 ? (
						<div className="rounded-lg border border-dashed py-8 text-center">
							<p className="text-muted-foreground text-sm">No teams found.</p>
						</div>
					) : (
						<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
							{teams.map((team) => (
								<Card key={team.id} className="group hover:border-primary/50 relative transition-colors">
									<CardHeader className="pb-2">
										<div className="flex items-center gap-2">
											<div className="bg-muted flex h-7 w-7 items-center justify-center rounded-md">
												<UsersRound className="text-muted-foreground h-3.5 w-3.5" />
											</div>
											<CardTitle className="text-sm">{team.name}</CardTitle>
										</div>
									</CardHeader>
									<CardContent className="pt-0">
										<div className="text-muted-foreground mb-2 font-mono text-xs">
											{team.customer_id && <span>Org: {team.customer_id}</span>}
										</div>
										<Button variant="outline" size="sm" className="group-hover:border-primary w-full text-xs" asChild>
											<Link to="/platform/console/teams/$teamId" params={{ teamId: team.id }}>
												Open
												<ChevronRight className="ml-1 h-3.5 w-3.5" />
											</Link>
										</Button>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}