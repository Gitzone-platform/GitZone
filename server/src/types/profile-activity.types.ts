export type ProfileActivityType = 'REPOSITORY_CREATED' | 'ISSUE_CREATED' | 'PULL_REQUEST_CREATED';

export interface ProfileActivity {
  id: string;
  type: ProfileActivityType;
  repository: {
    id: string;
    name: string;
  };
  number: number | null;
  title: string | null;
  createdAt: Date;
}

export interface ProfileActivityResponse {
  activities: ProfileActivity[];
}
