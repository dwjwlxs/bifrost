import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import FullPageLoader from "@/components/fullPageLoader";
import { Label } from "@/components/ui/label";
import { useGetCurrentUserQuery, useGetCurrentUserVirtualKeysQuery } from "@/lib/store";
import { formatCurrency } from "@/lib/utils/governance";
import { Budget, VirtualKey } from "@/lib/types/governance";
import { Edit2, Key, Shield, User as UserIcon, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

const POLLING_INTERVAL = 5000;

export default function ProfilePage() {
	const { data: currentUser, error: userError, isLoading: userLoading } = useGetCurrentUserQuery();

	// Get user's virtual keys
	const {
		data: userVKs,
		error: vksError,
		isLoading: vksLoading,
	} = useGetCurrentUserVirtualKeysQuery(undefined, {
		pollingInterval: POLLING_INTERVAL,
	});

	if (userLoading) {
		return <FullPageLoader />;
	}

	if (!currentUser) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">Unable to load user profile.</p>
			</div>
		);
	}

	// Calculate total usage across all VKs
	const totalSpent =
		userVKs?.virtual_keys.reduce((sum: number, vk) => {
			const vkSpent = vk.budgets?.reduce((bSum: number, b: Budget) => bSum + b.current_usage, 0) || 0;
			return sum + vkSpent;
		}, 0) || 0;

	// Calculate total budget limit
	const totalBudget =
		userVKs?.virtual_keys.reduce((sum: number, vk) => {
			const vkBudget = vk.budgets?.reduce((bSum: number, b: Budget) => bSum + b.max_limit, 0) || 0;
			return sum + vkBudget;
		}, 0) || 0;

	const grandTotalSpent = totalSpent;
	const grandTotalBudget = totalBudget;
	const budgetPercent = grandTotalBudget > 0 ? (grandTotalSpent / grandTotalBudget) * 100 : 0;

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Profile</h1>
					<p className="text-muted-foreground">Manage your account settings and view usage.</p>
				</div>
				<Button variant="outline" size="sm">
					<Edit2 className="mr-2 h-4 w-4" />
					Edit Profile
				</Button>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				{/* User Information Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserIcon className="h-5 w-5" />
							User Information
						</CardTitle>
						<CardDescription>Your account details and role.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label className="text-muted-foreground">Username</Label>
							<p className="font-medium">{currentUser.username}</p>
						</div>
						<div>
							<Label className="text-muted-foreground">Email</Label>
							<p className="font-medium">{currentUser.email}</p>
						</div>
						{currentUser.nickname && (
							<div>
								<Label className="text-muted-foreground">Nickname</Label>
								<p className="font-medium">{currentUser.nickname}</p>
							</div>
						)}
						<div>
							<Label className="text-muted-foreground">Role</Label>
							<div className="flex items-center gap-2">
								<Shield className="text-primary h-4 w-4" />
								<span className="font-medium capitalize">{currentUser.role}</span>
							</div>
						</div>
						{currentUser.team_id && (
							<div>
								<Label className="text-muted-foreground">Team</Label>
								<p className="font-medium">{currentUser.team?.name || currentUser.team_id}</p>
							</div>
						)}
						{currentUser.customer_id && (
							<div>
								<Label className="text-muted-foreground">Organization</Label>
								<p className="font-medium">{currentUser.customer?.name || currentUser.customer_id}</p>
							</div>
						)}
						<div>
							<Label className="text-muted-foreground">Status</Label>
							<span
								className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
									currentUser.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
								}`}
							>
								{currentUser.status}
							</span>
						</div>
						<div>
							<Label className="text-muted-foreground">Joined</Label>
							<p className="font-medium">{new Date(currentUser.created_at).toLocaleDateString()}</p>
						</div>
					</CardContent>
				</Card>

				{/* Balance and Usage Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Wallet className="h-5 w-5" />
							Balance & Usage
						</CardTitle>
						<CardDescription>Your account balance and API usage statistics.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label className="text-muted-foreground">Personal Balance</Label>
							<p className="text-2xl font-medium">{formatCurrency(currentUser.balance)}</p>
						</div>
						{grandTotalBudget > 0 && (
							<div>
								<Label className="text-muted-foreground">Total Usage (All VKs)</Label>
								<div className="space-y-1">
									<p className="font-medium">
										{formatCurrency(grandTotalSpent)} / {formatCurrency(grandTotalBudget)}
									</p>
									<div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
										<div
											className={`h-full transition-all ${budgetPercent > 90 ? "bg-red-500" : "bg-blue-500"}`}
											style={{ width: `${Math.min(budgetPercent, 100)}%` }}
										/>
									</div>
									<p className="text-muted-foreground text-xs">{budgetPercent.toFixed(1)}% used</p>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Virtual Keys Summary */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Key className="h-5 w-5" />
						Virtual Keys
					</CardTitle>
					<CardDescription>Summary of your virtual keys and their usage.</CardDescription>
				</CardHeader>
				<CardContent>
					{!userVKs || userVKs.virtual_keys.length === 0 ? (
						<div className="py-8 text-center">
							<Key className="text-muted-foreground mx-auto h-12 w-12" />
							<p className="text-muted-foreground mt-2">No virtual keys found.</p>
							<Button className="mt-4" variant="outline">
								Create Your First Key
							</Button>
						</div>
					) : (
						<div className="space-y-4">
							<div className="text-muted-foreground text-sm">
								You have access to {userVKs.virtual_keys.length} virtual key
								{userVKs.virtual_keys.length !== 1 ? "s" : ""}.
							</div>
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
								{userVKs.virtual_keys.slice(0, 6).map((vk) => (
									<div key={vk.id} className="hover:bg-muted/50 rounded-lg border p-4 transition-colors">
										<div className="mb-2 flex items-start justify-between">
											<p className="truncate font-medium">{vk.name}</p>
											{vk.is_active ? (
												<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Active</span>
											) : (
												<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">Inactive</span>
											)}
										</div>
										{vk.description && <p className="text-muted-foreground mb-2 line-clamp-2 text-sm">{vk.description}</p>}
										{vk.budgets && vk.budgets.length > 0 && (
											<div className="space-y-1">
												{vk.budgets.slice(0, 2).map((budget: Budget, idx: number) => (
													<div key={idx} className="text-xs">
														<div className="flex justify-between">
															<span className="text-muted-foreground">{budget.reset_duration} budget</span>
															<span>
																{formatCurrency(budget.current_usage)} / {formatCurrency(budget.max_limit)}
															</span>
														</div>
														<div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200">
															<div
																className={`h-full transition-all ${
																	budget.current_usage >= budget.max_limit ? "bg-red-500" : "bg-blue-500"
																}`}
																style={{
																	width: `${Math.min((budget.current_usage / budget.max_limit) * 100, 100)}%`,
																}}
															/>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								))}
							</div>
							{userVKs.virtual_keys.length > 6 && (
								<div className="text-center">
									<Button variant="link">View all {userVKs.virtual_keys.length} keys</Button>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}