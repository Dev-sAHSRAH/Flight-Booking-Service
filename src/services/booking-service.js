const axios = require("axios");
const { BookingRepository } = require("../repositories");
const db = require("../models");
const { ServerConfig, Queue } = require("../config");
const AppError = require("../utils/errors/app-error");
const { StatusCodes } = require("http-status-codes");
const { BOOKING_STATUS } = require("../utils/common/enums");
const { BOOKED, CANCELLED } = BOOKING_STATUS;

const bookingRepository = new BookingRepository();

async function createBooking(data) {
  const transaction = await db.sequelize.transaction();
  try {
    const flight = await axios.get(
      `${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}`
    );
    const flightData = flight.data.data;

    if (data.noOfSeats > flightData.totalSeats) {
      throw new AppError(
        "Required no. of seats not available",
        StatusCodes.BAD_REQUEST
      );
    }

    const totalBillingAmount = data.noOfSeats * flightData.price;
    const bookingPayload = { ...data, totalCost: totalBillingAmount };
    const booking = await bookingRepository.createBooking(
      bookingPayload,
      transaction
    );

    await axios.patch(
      `${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}/seats`,
      {
        seats: data.noOfSeats,
      }
    );

    await transaction.commit();
    return booking;
  } catch (error) {
    await transaction.rollback();
    console.log(error);
    throw new AppError(
      "Something went wrong!",
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
}

async function makePayment(data) {
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(data.bookingId);

    if (bookingDetails.status === CANCELLED) {
      throw new AppError("The booking has expired", StatusCodes.BAD_REQUEST);
    }

    const bookingTime = new Date(bookingDetails.createdAt);
    const currentTime = new Date();

    if (currentTime - bookingTime > 300000) {
      await cancelBooking(data.bookingId);
      throw new AppError("The booking has expired", StatusCodes.BAD_REQUEST);
    }

    if (bookingDetails.totalCost !== parseInt(data.totalCost)) {
      throw new AppError(
        "The amount of the payment does not match",
        StatusCodes.BAD_REQUEST
      );
    }
    if (bookingDetails.userId !== parseInt(data.userId)) {
      throw new AppError(
        "The user corresponding to the booking does not match",
        StatusCodes.BAD_REQUEST
      );
    }
    // we assume here the payment is successful
    await bookingRepository.update(
      data.bookingId,
      { status: BOOKED },
      transaction
    );
    Queue.sendData({
      recipientEmail: "charsha099@gmail.com",
      subject: "Flight Booked!",
      text: `Booking Succesfully done for the flight ${data.bookingId}`,
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function cancelBooking(bookingId) {
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(bookingId);
    if (bookingDetails.status === CANCELLED) {
      await transaction.commit();
      return true;
    }

    await axios.patch(
      `${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${bookingDetails.flightId}/seats`,
      {
        seats: bookingDetails.noOfSeats,
        dec: 0,
      }
    );

    await bookingRepository.update(
      bookingId,
      { status: CANCELLED },
      transaction
    );

    transaction.commit();
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

async function cancelOldBookings() {
  try {
    const currentTime = new Date(Date.now() - 1000 * 60 * 5); //5 minutes ago
    const response = await bookingRepository.cancelOldBookings(currentTime);
    return response;
  } catch (error) {
    console.log(error);
  }
}

module.exports = {
  createBooking,
  makePayment,
  cancelBooking,
  cancelOldBookings,
};
