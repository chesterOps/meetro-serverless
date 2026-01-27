import mongoose from "mongoose";

// Job interface for cron job tracking
export interface IJob {
  name: string;
  lastRunAt?: Date;
}

// Job static methods interface
interface IJobStatics {
  updateLastRun(name: string): Promise<IJob | null>;
  getLastRun(name: string): Promise<Date | null>;
}

// Job model type
type JobModel = mongoose.Model<IJob, {}, {}, {}> & IJobStatics;

// Job schema
const jobSchema = new mongoose.Schema<IJob, JobModel>({
  name: {
    type: String,
    required: [true, "Job name is required"],
    unique: true,
    trim: true,
  },
  lastRunAt: {
    type: Date,
    default: null,
  },
});

// Static method to update last run time
jobSchema.statics.updateLastRun = async function (
  name: string,
): Promise<IJob | null> {
  return this.findOneAndUpdate(
    { name },
    { lastRunAt: new Date() },
    { new: true, upsert: true },
  );
};

// Static method to get last run time
jobSchema.statics.getLastRun = async function (
  name: string,
): Promise<Date | null> {
  const job = await this.findOne({ name });
  return job ? job.lastRunAt || null : null;
};

// Create and export model
const Job = mongoose.model<IJob, JobModel>("Job", jobSchema);

export default Job;
